# Phase 16: Offline Resilience

**Priority**: P3 (Medium)
**Status**: Planning
**Estimated Total Time**: 12-16 hours

## Overview

Implement offline capabilities for critical system functionality to ensure operational continuity when internet connectivity is unavailable. This phase focuses on enabling the map visualization to work without external dependencies by self-hosting map tiles and providing graceful fallback mechanisms.

## Context

The KP Rück system currently depends on external services for map functionality:
- **OpenStreetMap Tile Servers** (`tile.openstreetmap.org`) for map visualization
- **Nominatim API** (`nominatim.openstreetmap.org`) for address geocoding

In emergency situations, internet connectivity may be unreliable or unavailable. The system must continue to function in these scenarios, particularly for critical features like:
- Viewing incident locations on the map
- Creating new incidents with geographic data
- Accessing the operational dashboard

## Goals

1. **Map Resilience**: Enable offline map tile rendering for the Basel-Landschaft region
2. **Automatic Failover**: Seamless transition from online to offline mode when connectivity is lost
3. **Manual Control**: Allow operators to explicitly choose online/offline mode
4. **User Experience**: Improved location selection with map-based coordinate picker
5. **Maintainability**: Simple process for updating offline map data when needed

## Scope

### In Scope
- Self-hosted map tile server for offline operation
- Basel-Landschaft region coverage (zoom levels 0-17)
- Automatic fallback from online to local tiles
- Manual online/offline mode toggle
- Map-based location picker component
- Clear online/offline status indicators
- Documentation for tile data updates

### Out of Scope
- Full Switzerland coverage (can be added later if needed)
- Offline geocoding/address search (manual coordinate selection is sufficient)
- Real-time map data updates
- Satellite imagery (only street map tiles)
- Mobile app offline support (web-only)

## Tasks

### 16.1: Offline Map Tiles with Automatic Fallback (12-16h)
Implementation of self-hosted map tile server with intelligent online/offline switching and map-based location selection.

**Status**: Not Started
**Complexity**: Medium
**Dependencies**: None (can be implemented immediately)

## Technical Approach

### Architecture
```
┌─────────────────────────────────────────┐
│         Frontend (Leaflet Map)          │
│                                         │
│  ┌───────────────────────────────────┐ │
│  │   Try: tile.openstreetmap.org     │ │
│  │   Fallback: localhost:8080        │ │
│  │   Manual Toggle: Online/Offline   │ │
│  └───────────────────────────────────┘ │
└─────────────────────────────────────────┘
                   │
        ┌──────────┴──────────┐
        ▼                     ▼
┌──────────────┐    ┌──────────────────┐
│  Online OSM  │    │  Local TileServer│
│   (Primary)  │    │  (Fallback/Force)│
└──────────────┘    └──────────────────┘
                            │
                    ┌───────┴────────┐
                    │  MBTiles Data  │
                    │ (Basel Region) │
                    │  ~1-2 GB       │
                    └────────────────┘
```

### Technology Stack
- **Tile Server**: `maptiler/tileserver-gl` (Docker)
- **Tile Format**: MBTiles (compact single-file storage)
- **Map Data**: OpenStreetMap Switzerland extract
- **Frontend**: Leaflet TileLayer with error handlers
- **Tile Generation**: `tilemaker` or pre-generated MBTiles

### Data Storage
- **Size**: ~1-2 GB for Basel-Landschaft at zoom 0-17
- **Location**: Docker volume `tileserver-data`
- **Update Frequency**: Manual (typically every 3-6 months)
- **Retention**: Keep previous version during updates

## Success Criteria

- [ ] System functions normally when online (uses OSM tiles)
- [ ] System automatically switches to local tiles when offline
- [ ] Manual toggle allows forcing offline mode
- [ ] Map loads within 2 seconds with local tiles
- [ ] Zoom levels 10-17 render correctly for Basel area
- [ ] Location picker works for incident creation
- [ ] Online/offline status clearly indicated
- [ ] Tile update instructions are clear and tested
- [ ] No degradation in map quality compared to online mode
- [ ] Docker setup runs reliably on restart

## Non-Functional Requirements

- **Performance**: Local tiles load as fast as online (target: <500ms per tile)
- **Storage**: Total storage under 3 GB (system + tiles)
- **Memory**: Tile server uses <512 MB RAM
- **Compatibility**: Works on Docker for Mac/Linux
- **Maintainability**: Tile updates require <30 minutes of work

## Future Enhancements (Post-Phase 16)

- Extend coverage to full Switzerland
- Add offline geocoding for known addresses
- Implement differential tile updates
- Support for satellite/terrain tiles
- Mobile-optimized tile formats
- Multi-region tile sets
- Automatic online/offline detection
- Progressive tile download on first use

## References

- **OpenStreetMap Data**: https://download.geofabrik.de/europe/switzerland.html
- **TileServer GL**: https://github.com/maptiler/tileserver-gl
- **MBTiles Spec**: https://github.com/mapbox/mbtiles-spec
- **Leaflet Error Handling**: https://leafletjs.com/reference.html#tilelayer-error
- **Docker Volumes**: https://docs.docker.com/storage/volumes/

## Related Documentation

- `DESIGN_DOC.md` - Section 4.3 (Map Integration)
- `CLAUDE.md` - Section "Common Pitfalls & Lessons Learned"
- `tasks/phase-3-map/3.2-map-view-ui.md` - Original map implementation
- `docker-compose.yml` - Service configuration

---

**Last Updated**: 2025-10-30
**Phase Lead**: TBD
**Reviewers**: TBD
