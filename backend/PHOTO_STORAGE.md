# Photo Storage Configuration for Railway

## Overview

The KP Rück backend supports photo uploads for Reko (field reconnaissance) reports. Photos are stored on disk and require persistent storage on Railway to survive container restarts.

## Storage Strategy

### Directory Structure
```
{PHOTOS_DIR}/                      # Configurable root directory
├── {incident-uuid-1}/             # One directory per incident
│   ├── {photo-uuid-1}.jpg
│   ├── {photo-uuid-2}.jpg
│   └── ...
├── {incident-uuid-2}/
│   └── ...
└── ...
```

### File Processing
- **Format**: All photos are converted to JPEG (regardless of upload format)
- **Compression**: JPEG quality 85 with optimization enabled
- **Resizing**: Images wider than 1920px are resized (aspect ratio preserved)
- **File naming**: Photos are saved as `{uuid}.jpg` (random UUID)
- **Max size**: 10MB per file (before compression)
- **Max count**: 20 photos per report

## Railway Deployment

### Volume Setup

1. **Attach Volume to Backend Service:**
   - In Railway dashboard → Backend service → Settings → Volumes
   - Mount path: `/mnt/data`
   - Size: As needed for your photos (recommended: 5GB+)

2. **Set Environment Variable:**
   ```bash
   PHOTOS_DIR=/mnt/data/photos
   ```

   This tells the backend to store photos on the persistent volume instead of the ephemeral container filesystem.

### Startup Process

The `start.sh` script automatically:
1. Creates the photos directory if it doesn't exist
2. Verifies the directory is writable
3. Logs the photo storage location for debugging
4. Fails the container startup if the directory isn't writable

Example startup logs:
```
Starting KP Rück Backend...
Environment: PORT=8000, DATABASE_URL=postgresql+asyncpg://...
Photo storage directory: /mnt/data/photos
Creating photos directory: /mnt/data/photos
Photos directory ready: /mnt/data/photos
Running database migrations...
```

### Environment Variables

| Variable | Default | Production Value | Description |
|----------|---------|------------------|-------------|
| `PHOTOS_DIR` | `data/photos` | `/mnt/data/photos` | Root directory for photo storage |
| `MAX_PHOTO_SIZE_MB` | `10` | `10` | Maximum file size in MB |
| `MAX_PHOTOS_PER_REPORT` | `20` | `20` | Maximum photos per Reko report |

## Testing

### Local Development
```bash
cd backend

# Run photo storage tests
uv run pytest tests/test_services/test_photo_storage.py -v

# Run all tests
uv run pytest
```

All tests should pass with 99% code coverage for `photo_storage.py`.

### Manual Testing

1. **Start backend locally:**
   ```bash
   cd backend
   uv run uvicorn app.main:app --reload
   ```

2. **Generate Reko link for an incident:**
   ```bash
   curl -X POST http://localhost:8000/api/reko/generate-link \
     -H "Content-Type: application/json" \
     -d '{"incident_id": "YOUR_INCIDENT_UUID"}'
   ```

3. **Upload a test photo:**
   ```bash
   curl -X POST http://localhost:8000/api/reko/YOUR_INCIDENT_UUID/photos \
     -H "X-Reko-Token: YOUR_TOKEN" \
     -F "file=@/path/to/test-image.jpg"
   ```

4. **Verify photo was saved:**
   ```bash
   ls -lh data/photos/YOUR_INCIDENT_UUID/
   ```

5. **Access photo via browser:**
   ```
   http://localhost:8000/api/photos/YOUR_INCIDENT_UUID/FILENAME.jpg
   ```

### Volume Simulation (Docker)

Test with a volume mount to simulate Railway:

```bash
# Create local volume directory
mkdir -p /tmp/test-photos

# Run with volume mount
docker run -it \
  -v /tmp/test-photos:/mnt/data \
  -e PHOTOS_DIR=/mnt/data/photos \
  -e DATABASE_URL=your_db_url \
  -p 8000:8000 \
  your-backend-image

# Verify photos persist
ls -lh /tmp/test-photos/photos/
```

## API Endpoints

### Photo Upload
```http
POST /api/reko/{incident_id}/photos
Headers:
  X-Reko-Token: {form_token}
  Content-Type: multipart/form-data
Body:
  file: (binary)

Response:
  { "filename": "550e8400-e29b-41d4-a716-446655440000.jpg" }
```

### Photo Serving
```http
GET /api/photos/{incident_id}/{filename}

Response:
  Image file (image/jpeg)
  Cache-Control: public, max-age=31536000, immutable
```

### Photo Deletion
```http
DELETE /api/reko/{incident_id}/photos/{filename}
Headers:
  X-Reko-Token: {form_token}

Response:
  { "success": true }
```

## Security Considerations

### Access Control
- **Upload**: Requires valid form token (generated per incident)
- **Viewing**: No authentication (photos are public once uploaded)
- **Deletion**: Requires valid form token (same as upload)

### File Validation
- Extension check: Only `.jpg`, `.jpeg`, `.png`, `.webp` allowed
- Size limit: 10MB per file (configurable)
- Content validation: PIL opens and validates image data
- Safe filenames: Random UUIDs prevent directory traversal

### Performance
- **Compression**: Reduces storage and bandwidth usage
- **Caching**: 1-year cache headers for CDN/browser caching
- **Cleanup**: Empty incident directories are automatically removed

## Troubleshooting

### Photos Not Persisting After Restart

**Symptom**: Photos disappear when Railway container restarts.

**Cause**: `PHOTOS_DIR` not set, or not pointing to volume mount.

**Solution**:
1. Verify volume is mounted at `/mnt/data` in Railway dashboard
2. Set `PHOTOS_DIR=/mnt/data/photos` environment variable
3. Redeploy the service
4. Check startup logs for "Photo storage directory: /mnt/data/photos"

### Permission Denied Errors

**Symptom**: Startup fails with "ERROR: Photos directory is not writable"

**Cause**: Volume mount has wrong permissions.

**Solution**:
1. Check Railway volume is properly attached
2. Verify mount path is exactly `/mnt/data`
3. Railway volumes should automatically have correct permissions
4. If issue persists, detach and re-attach the volume

### Photos Not Displaying

**Symptom**: Photo upload succeeds but serving returns 404.

**Cause**: Photo path mismatch between upload and serving.

**Solution**:
1. Check `PHOTOS_DIR` is consistent across all containers
2. Verify incident ID is correct (must be exact UUID)
3. Check filename was correctly returned from upload endpoint
4. Verify file exists: `ls /mnt/data/photos/{incident_id}/`

### Large Photo Files

**Symptom**: Upload fails with "File too large" error.

**Cause**: File exceeds 10MB limit (or custom `MAX_PHOTO_SIZE_MB`).

**Solution**:
1. Client should compress photos before upload (mobile apps should do this automatically)
2. Or increase `MAX_PHOTO_SIZE_MB` environment variable
3. Note: Backend automatically compresses/resizes after validation

## Monitoring

### Health Checks

Monitor startup logs for photo directory initialization:
```bash
# Railway CLI
railway logs --service backend | grep -i photo

# Expected output:
# Photo storage directory: /mnt/data/photos
# Photos directory ready: /mnt/data/photos
```

### Storage Usage

Check volume usage in Railway dashboard:
- Settings → Volumes → Usage

### Disk Space Calculation

Estimate storage needs:
```
Average compressed photo: ~200KB (after 1920px resize, JPEG quality 85)
Max photos per report: 20
Max size per report: ~4MB

100 reports with max photos: ~400MB
1000 reports: ~4GB
```

## Migration Notes

### Migrating from Ephemeral Storage

If you previously deployed without a volume:

1. **Photos are lost**: Ephemeral storage doesn't persist across deployments
2. **No migration needed**: Start fresh with volume-backed storage
3. **Update environment**: Set `PHOTOS_DIR=/mnt/data/photos`
4. **Redeploy**: Photos uploaded after this point will persist

### Backup Strategy

Railway volumes are persistent but not automatically backed up:

1. **Periodic backups**: Use Railway CLI or API to download photos
2. **S3 integration**: Consider migrating to S3 for automatic backups (future enhancement)
3. **Snapshot**: Railway may offer volume snapshots (check current features)

## Future Enhancements

- [ ] S3/CloudFlare R2 backend for better scalability
- [ ] WebP output format support (better compression)
- [ ] Thumbnail generation for faster preview loading
- [ ] Automatic cleanup of deleted incidents
- [ ] Photo rotation based on EXIF data
- [ ] Progressive image loading support

## Support

For issues related to photo storage:

1. Check Railway deployment logs
2. Verify volume is attached and accessible
3. Test with manual upload/download endpoints
4. Review this documentation
5. Check GitHub issues for similar problems
