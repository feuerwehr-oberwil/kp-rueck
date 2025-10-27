# Notification Alert Sounds

This directory contains audio files for critical notification alerts.

## Current Alert Sound

- `mixkit-digital-quick-tone-2866.wav` - Digital quick tone for critical notifications

Source: Mixkit (https://mixkit.co/free-sound-effects/)

## File Requirements

- Format: WAV or MP3
- Duration: 1-3 seconds recommended
- Volume: Normalized, not too loud
- Type: Alert sound (e.g., bell, chime, alarm)

## Changing the Alert Sound

To use a different alert sound:
1. Add your audio file to this directory
2. Update the audio reference in `lib/contexts/notification-context.tsx`
3. Update this README with the new filename and source

The notification system will play this sound when critical notifications are triggered.
