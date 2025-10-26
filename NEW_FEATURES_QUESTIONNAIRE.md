# New Features Planning Questionnaire

**Date**: 2025-10-26
**Status**: Awaiting Answers
**Purpose**: Define requirements for 6 new features before implementation

---

## Instructions

Please answer the questions below. For each question:
- Replace `[ YOUR ANSWER HERE ]` with your response
- Feel free to be as detailed or concise as needed
- Mark N/A if a question doesn't apply
- Add additional notes/thoughts anywhere you'd like

After completing this questionnaire, I'll create detailed task specifications for implementation.

---

## Feature 1: Bidirectional Railway ↔ Local Sync (Enhanced Offline Capabilities)

**Current State**: Task 6.2 implements one-way Railway→Local sync every 5 minutes

### Scope & Requirements

**Q1. Conflict Resolution**: When both Railway and Local are edited during an outage, how should conflicts be resolved?
- [x] Last-write-wins by timestamp
- [ ] Manual conflict resolution UI
- [x] Priority system (Local always wins during failover mode) <- if timestamps are too similar then local
- [ ] Other: [ YOUR ANSWER HERE ]

**Q2. Sync Triggers**: What should trigger sync operations? (select all that apply)
- [x] Time-based (every X minutes - specify: 2 minutes but make it editable in the settings page)
- [x] Event-based (on incident creation/update) <- even if the minutes are set longer, add an additional sync for new events, incidents
- [ ] Manual trigger button in UI
- [ ] Health-check-based (sync faster when Railway is unstable)
- [ ] Other: [ YOUR ANSWER HERE ]

**Q3. Offline Mode Detection**: How should the system detect which environment is "active"?
- [ ] Manual switch in settings ("Activate Local Mode")
- [ ] Automatic detection based on health checks
- [ ] Indicator in UI showing active environment
- [x] Other: by default people will be working online with the offline/local mode just running on the computer somewhere. only once the internet is down then people will open up the local mode and continue working -> so there is no clear "switch". does that make sense? we want to work with the railway instance for as long as possible since it allows the reko reports and user addition way more seamlessly than the pure local/on-device instance

**Q4. Data Scope**: What data should sync bidirectionally? (select all that apply)
- [x] All incidents
- [x] Personnel data
- [x] Vehicles
- [x] Materials
- [ ] Photos (note: could be large)
- [ ] Audit logs
- [x] Settings changes
- [ ] Other: [ YOUR ANSWER HERE ]

### Technical Implementation

**Q5. Sync Strategy**: Which approach should we use?
- [ ] Database-level replication (PostgreSQL streaming replication)
- [ ] Application-level sync (API-based with delta detection)
- [x] Hybrid (critical data real-time, bulk data periodic)
- [ ] Other: [ YOUR ANSWER HERE ]

**Q6. Version Control**: How do we track changes for delta sync?
- [x] Add `updated_at` timestamp to all tables <- unless you think a synclog table is way better
- [ ] Add `version` field (increment on each update)
- [ ] Use dedicated `sync_log` table
- [ ] Other: [ YOUR ANSWER HERE ]

**Q7. Photo Storage**: Photos are filesystem-based. How to sync them?
- [ ] rsync between environments
- [ ] Convert to base64 and include in DB
- [x] Accept photos may be missing during failover (they only add context but don't make it / break it)
- [ ] Other: [ YOUR ANSWER HERE ]

### UI/UX

**Q8. User Visibility**: What should users see? (select all that apply)
- [x] Sync status indicator (green=synced, yellow=syncing, red=offline)
- [x] Last sync timestamp
- [ ] "Switch to Local Mode" button
- [x] Warnings when data may be stale
- [ ] Other: [ YOUR ANSWER HERE ]

**Q9. Failover Process**: Should failover be:
- [ ] Automatic (system detects Railway down, switches to Local)
- [ ] Manual (admin clicks "Activate Offline Mode")
- [ ] Hybrid (automatic detection + manual confirmation)
- [ ] Other: check the answers above. it's not a selection but more a fact if the deployment is down that you "have" to work with the local version

**Additional Notes for Feature 1**:
```
[ YOUR ADDITIONAL THOUGHTS/REQUIREMENTS HERE ]
```

---

## Feature 2: Dashboard Notification System

**Current State**: Basic reko notifications exist, but no system-wide alerting

### Alert Criteria

**Q10. Time-Based Alerts**: What durations trigger notifications?

| Alert Type | Duration | Enable? |
|------------|----------|---------|
| Card in "Eingegangen" | 60 minutes | [x] Yes [ ] No |
| Card in "Reko" | 60 minutes | [x] Yes [ ] No |
| Card in "Disponiert/Unterwegs" | 20 minutes | [x] Yes [ ] No |
| Card in "Einsatz" | 2 hours | [x] Yes [ ] No |
| Card in "Einsatz beendet/Rückfahrt" | 20 minutes | [x] Yes [ ] No |
| Card not archived after completion | 1 hours | [x] Yes [ ] No |
| Other: _____________ | _____ | [ ] Yes [ ] No |

**Q11. Resource Alerts**: What resource conditions need alerts? (select all that apply)
- [x] All personnel assigned (none available)
- [ ] All vehicles assigned
- [x] Critical materials depleted
- [x] Personnel assigned > X hours (fatigue alert) - specify hours: edit in settings but default = 4
- [ ] Other: [ YOUR ANSWER HERE ]

**Q12. Data Quality Alerts**: What missing/incomplete data should trigger warnings? (select all that apply)
- [x] Incident missing geocoded location
- [x] Incident missing assigned personnel <- only when assigned/set to "Einsatz" column
- [x] Incident missing assigned vehicle <- only for "Disponiert"
- [ ] Reko form overdue (incident in "Reko" but no submission)
- [ ] Photos missing from critical incidents
- [ ] Other: [ YOUR ANSWER HERE ]

**Q13. Event/Training Alerts**: Event-specific notifications? (select all that apply)
- [ ] Training event still active after X hours - specify: _____
- [ ] No incidents in current event (event might be inactive)
- [x] Event approaching data size limits
- [ ] Other: [ YOUR ANSWER HERE ]

### UI/UX

**Q14. Notification Display**: Where/how should alerts appear? (select all that apply)
- [x] Toast notifications (bottom-right corner)
- [x] Dedicated "Notifications" panel in sidebar <- have a list of historical events be available but only show the currently active ones unless clicking on them. somewhat similar to macos's notification sidebar
- [ ] Badge count on status columns
- [ ] Alert banner at top of screen
- [x] Audio alerts for critical issues
- [ ] Other: [ YOUR ANSWER HERE ]

**Q15. Notification Persistence**: How long should notifications stay visible?
- [x] Dismiss manually only <- ensure normal toasts (e.g. copy to clipboard done) goes away automatically
- [ ] Auto-dismiss after X seconds - specify: _____
- [x] Keep in "notification history" panel
- [x] Different persistence for different severity levels (specify below) <- check above
- [ ] Other: [ YOUR ANSWER HERE ]

**Q16. Notification Grouping**: Should similar alerts be grouped?
- [ ] Yes - group similar alerts (e.g., "3 incidents overdue in Eingegangen")
- [x] No - show individual notifications
- [ ] Group by type (time-based, resource-based, etc.)
- [ ] Other: [ YOUR ANSWER HERE ]

### Configuration

**Q17. Settings Toggles**: Which alerts should be configurable? (select all that apply)
- [x] Enable/disable each alert type individually
- [x] Adjust time thresholds per alert
- [x] Editor-only settings (global)
- [ ] Per-user preferences (if we add user profiles later)
- [x] Different alert sets for Training vs. Live mode (two columns with the time thresholds)
- [ ] Other: [ YOUR ANSWER HERE ]

**Q18. Alert Severity Levels**: Should we categorize alerts?
- [x] Yes, use severity levels:
  - Critical (specify criteria): no more resources
  - Warning (specify criteria): time overdue
  - Info (specify criteria): anything else
- [ ] No, all alerts same priority
- [ ] Other: [ YOUR ANSWER HERE ]

**Additional Notes for Feature 2**:
```
[ YOUR ADDITIONAL THOUGHTS/REQUIREMENTS HERE ]
```

---

## Feature 3: CSV Import for Personnel/Materials (Open-Source Data Sanitization)

**Current State**: Seed data is hardcoded in `app/seed.py`

### Data Format

**Q19. CSV Structure**: What columns for each entity type?

**Personnel CSV columns**:
```
[ Example: name, role, availability, divera alarm ID (optional), phone number (optional) ]
[ List all columns you want, mark required vs optional ]
```

**Vehicles CSV columns**:
```
[ Example: name, type, status, index/order ]
[ List all columns you want, mark required vs optional ]
```

**Materials CSV columns**:
```
[ Example: name, type, quantity (not as column but as duplicate entries <- i.e. don't deduplicate), location ]
[ List all columns you want, mark required vs optional ]
```

**Q20. Data Validation**: What validation rules on import? (select all that apply)
- [x] Validate required fields (reject row if missing)
- [x] Enum validation (vehicle types, personnel roles)
- [ ] Duplicate detection by name
- [ ] Duplicate detection by ID (if CSV includes IDs)
- [ ] Invalid data handling:
  - [ ] Skip invalid rows, import valid ones
  - [x] Reject whole file if any errors
  - [x] Show errors, let user fix and re-upload
- [ ] Other: [ YOUR ANSWER HERE ]

**Q21. Anonymization/Sanitization**: For open-sourcing, what should be anonymized?
- [ ] Replace real names with "Person 1", "Person 2", etc.
- [ ] Generic vehicle names "Engine 1", "Ladder 1", etc.
- [ ] Remove phone numbers and addresses
- [ ] Auto-generate sample data script instead of using real data
- [x] Not needed - we'll manually sanitize before open-sourcing (be very careful and double check)
- [ ] Other: [ YOUR ANSWER HERE ]

### UI/UX

**Q22. Upload Interface**: Where/how should CSV upload work?
- [ ] Settings page with "Import Data" section
- [x] Separate "/admin/import" page
- [x] Support drag-and-drop
- [x] File picker dialog
- [ ] Multi-file upload (personnel.csv, vehicles.csv, materials.csv separately)
- [ ] Single combined file (all entity types in one CSV with type column)
- [x] Other: excel file (give empty template) and each part as separate sheet

**Q23. Import Behavior**: What happens to existing data on import?
- [ ] Replace all (delete existing, insert new)
- [ ] Merge (update existing by name/ID, add new)
- [ ] Append only (never delete, only add)
- [x] User chooses mode on upload (dropdown or radio buttons)
- [ ] Other: [ YOUR ANSWER HERE ]

**Q24. Import Preview**: Before committing import, should users see: (select all that apply)
- [x] Preview of first 10 rows
- [ ] Validation errors highlighted
- [ ] "Dry run" mode to test import
- [x] Confirmation dialog showing impact (X rows added, Y updated, Z deleted)
- [ ] No preview - just import immediately
- [ ] Other: [ YOUR ANSWER HERE ]

### Technical

**Q25. Export Function**: Should we also support CSV export (for backup)? (select all that apply)
- [x] Export current data to excel (same format as import)
- [x] Include all fields
- [x] Sanitized version (no PII)
- [x] Single "Export All" button
- [ ] Separate export per entity type
- [ ] Not needed
- [ ] Other: [ YOUR ANSWER HERE ]

**Q26. Permissions**: Who can import data?
- [x] Editor role only
- [ ] New "Admin" role (would need to implement this)
- [ ] Anyone authenticated
- [x] Audit log all imports (who, when, what changed)
- [ ] Other: [ YOUR ANSWER HERE ]

**Additional Notes for Feature 3**:
```
[ YOUR ADDITIONAL THOUGHTS/REQUIREMENTS HERE ]
```

---

## Feature 4: Incident Export for Legal/Paper Trail

**Current State**: No export functionality exists yet

### Export Formats

**Q27. Output Formats**: Which formats do you need? (select all that apply)
- [x] PDF (formatted report)
- [ ] CSV (raw data for spreadsheet)
- [ ] JSON (machine-readable)
- [x] Excel/XLSX
- [ ] Other: [ YOUR ANSWER HERE ]

**Q28. PDF Report Structure**: If PDF export, what should it contain? (select all that apply)
- [ ] Single incident detailed report
- [x] Multiple incidents summary table
- [ ] Include photos inline
- [x] Include Reko report data
- [x] Include map screenshot (showing incident location)
- [x] Timeline of status transitions
- [ ] Assigned resources history
- [x] Audit log entries
- [ ] Other: [ YOUR ANSWER HERE ]

### Data Scope

**Q29. Export Scope**: What data should be exportable? (select all that apply)
- [ ] Individual incident (one at a time from incident card)
- [ ] Filtered incidents (by date range, status, type)
- [x] All incidents for an event
- [ ] All archived incidents
- [ ] Training incidents separately from live incidents
- [ ] Other: [ YOUR ANSWER HERE ]

**Q30. Included Data**: For each incident export, include: (select all that apply)
- [x] Basic fields (title, type, priority, location)
- [x] Timeline (created, status transitions, completed)
- [x] Assignments (personnel, vehicles, materials) with timestamps
- [x] Reko report (if exists)
- [x] Photos (embedded in PDF or as separate ZIP file) <- zip
- [x] Audit log entries
- [ ] Comments/notes field (if we add this feature)
- [ ] Other: [ YOUR ANSWER HERE ]

### Legal Requirements

**Q31. Legal Compliance**: What legal requirements for fire department records?

- **Required retention period**: 5 years
- **Digital signature needed**: [ ] Yes [x] No [ ] Not sure
- **Specific format mandated by regulations**: no
- **Archival format**: [x] PDF/A (long-term preservation) [ ] Regular PDF [ ] Not sure
- **Metadata requirements**: [ YOUR ANSWER HERE ]

**Q32. Report Template**: Should reports include: (select all that apply)
- [ ] Fire department logo/header
- [ ] Official document numbering (auto-generated)
- [ ] Statement of authenticity ("This is a true record of...")
- [x] Signature lines for commander approval
- [x] Export date and exported-by user
- [ ] Other: [ YOUR ANSWER HERE ]

### UI/UX

**Q33. Export Triggers**: Where can users export data? (select all that apply)
- [ ] "Export" button on individual incident card
- [ ] Bulk export from incident list (with checkboxes to select incidents)
- [x] Dedicated "Reports" or "Export" page
- [ ] Export from archive view
- [x] Export from event overview
- [ ] Other: [ YOUR ANSWER HERE ]

**Q34. Export Options UI**: Should users configure export on-the-fly?
- [ ] Yes - select format (PDF/CSV/Excel) before export with dropdown
- [ ] Yes - choose included data (checkboxes for photos, Reko, etc.)
- [ ] Yes - filter by date range
- [ ] No - have preset export templates:
  - Template 1 name: _____ (includes: _____)
  - Template 2 name: _____ (includes: _____)
  - Template 3 name: _____ (includes: _____)
- [x] Other: always export the full event. not single incidents. there will only be one single format of export

**Additional Notes for Feature 4**:
```
[ YOUR ADDITIONAL THOUGHTS/REQUIREMENTS HERE ]
```

---

## Feature 5: Comprehensive Help Documentation

**Current State**: Keyboard shortcuts help exists, but limited documentation

### Content Scope

**Q35. Documentation Topics**: What should help docs cover? (select all that apply)
- [x] Getting started / first-time user guide
- [x] Incident workflow explanation (why 6 status columns)
- [x] How to use each feature (Kanban, Map, Reko forms, Check-in, etc.)
- [x] Best practices (when to archive, how to handle multiple incidents)
- [ ] Troubleshooting common issues
- [x] Keyboard shortcuts (expand existing documentation)
- [ ] Mobile app usage guide (for viewers)
- [x] Event management (creating, switching, archiving events)
- [ ] Other: [ YOUR ANSWER HERE ]

**Q36. Audience**: Who are the primary users of help docs? (rank 1-4, 1=most important)
- [x] 1 Editors (command post operators)
- [x] 4 Mobile viewers (field personnel)
- [ ] ___ New trainees
- [ ] ___ Administrators (setup/config)

**Q37. Firefighting Context**: Should docs explain KP Rück concepts?
- [ ] Yes - explain what "Reko" (reconnaissance) means
- [ ] Yes - explain why "Disponiert/Unterwegs" vs. "Einsatz" matters
- [ ] Yes - typical workflow for common incident types (fire, medical, technical)
- [ ] Yes - include real-world examples from Demo Fire Department procedures
- [x] No - assume users know firefighting terminology
- [ ] Other: [ YOUR ANSWER HERE ]

### Format & Presentation

**Q38. Documentation Format**: How should help be presented? (select preferred option + any alternatives)
- [ ] In-app help panel (sidebar that slides out)
- [x] Dedicated `/help` page in the app <- replacing the current ? button only
- [ ] Tooltips on hover throughout UI
- [ ] Contextual help (? icon next to features)
- [ ] External documentation site (GitHub Pages, etc.)
- [x] Downloadable PDF manual <- just make the help pages downloadable. don't use any fancy formatting and only export the wording there
- [ ] Other: [ YOUR ANSWER HERE ]

**Q39. Interactive Elements**: Should help include: (select all that apply)
- [x] Screenshots
- [ ] Screen recordings / GIF demonstrations
- [ ] Interactive tutorial (first-time user walkthrough)
- [ ] Video tutorials (YouTube or embedded)
- [ ] "Tips of the day" on dashboard
- [ ] Search functionality
- [ ] Other: [ YOUR ANSWER HERE ]

**Q40. Content Organization**: How to structure help docs?
- [ ] Hierarchical (Getting Started > Incidents > Creating Incidents)
- [ ] Task-based ("How do I...?" FAQs)
- [ ] Feature-based (one page per feature: Kanban, Map, Reko, etc.)
- [x] Searchable wiki-style (all topics searchable)
- [x] Other: no big opinion. any reccomendation what works for somewhat knowlegeable users but that might forget things?

### Maintenance

**Q41. Content Management**: How to keep docs updated?
- [x] Markdown files in repo (version-controlled with code)
- [ ] CMS/admin panel for editors to update docs without code changes
- [ ] I (or team) will maintain documentation manually
- [x] Docs reviewed on each feature release
- [ ] Other: [ YOUR ANSWER HERE ]

**Q42. Localization**: Language considerations?
- [x] German only (primary language)
- [ ] English for open-source contributors
- [ ] Support both German and English with language toggle
- [ ] Swiss German dialect considerations (different terminology)
- [ ] Other: [ YOUR ANSWER HERE ]

**Additional Notes for Feature 5**:
```
[ YOUR ADDITIONAL THOUGHTS/REQUIREMENTS HERE ]
```

---

## Feature 6: Codebase Review & Suggested Improvements

**Based on DESIGN_DOC.md, kp-rück-komplett.png, and current implementation**

### Pain Points

**Q43. Current Pain Points**: From your experience so far, what workflow steps feel clunky or incomplete?

**Manual steps that should be automated**:
```
so far nothing. skip
```

**UI interactions that feel slow**:
```
[ YOUR ANSWER HERE ]
```

**Missing keyboard shortcuts for common actions**:
```
[ YOUR ANSWER HERE ]
```

### KP Rück Workflow Alignment

**Q44. Workflow Gap Analysis**: From the kp-rück-komplett.png diagram, which parts of the workflow are NOT yet reflected in the digital system?

**Missing workflow stages**:
```
status updates of the cars in the fields. some sort of vehicle tracking would be amaaaazin but check / discuss feasibility. ideally with divera integration or similar
```

**Missing roles/responsibilities**:
```
none
```

**Missing integrations**:
```
non that aren't going to be done
```

**Missing decision points**:
```
none
```

### Real-World Usage

**Q45. Optimization Opportunities**: Based on your fire department's needs:

**Scenarios that happen frequently but aren't optimized**:
```
ignore for now
```

**"Happy path" flows that should be one-click**:
```
[ YOUR ANSWER HERE ]
```

**Repetitive data entry that could be automated**:
```
[ YOUR ANSWER HERE ]
```

### Review Focus Areas

**Q46. What should I focus on when reviewing?** (rank 1-7, 1=highest priority)
- [x] 1 Performance bottlenecks
- [ ] ___ Security vulnerabilities
- [x] 2 Code quality/technical debt
- [x] 3 Missing error handling
- [ ] ___ Accessibility (a11y) issues
- [x] 4 Mobile responsiveness gaps
- [ ] ___ Other: [ YOUR ANSWER HERE ]

**Additional Notes for Feature 6**:
```
[ YOUR ADDITIONAL THOUGHTS/REQUIREMENTS HERE ]

Specific areas of concern:
[ YOUR ANSWER HERE ]

Features from kp-rück-komplett.png to investigate:
[ YOUR ANSWER HERE ]
```

---

## Priority & Timeline

### Implementation Priority

**Q47. How would you rank these 6 features?** (1=highest priority, 6=lowest)

- [x] 2 Feature 1: Bidirectional Railway ↔ Local Sync
- [x] 3 Feature 2: Dashboard Notification System
- [x] 1 Feature 3: CSV Import for Personnel/Materials
- [x] 4 Feature 4: Incident Export for Legal/Paper Trail
- [x] 6 Feature 5: Comprehensive Help Documentation
- [x] 5 Feature 6: Codebase Review & Improvements

### Timeline Constraints

**Q48. Are there any deadline constraints?**
- [ ] Need before November 2025 MVP milestone: [ LIST FEATURES ]
- [ ] Need before March 2026 Production Ready milestone: [ LIST FEATURES ]
- [ ] Post-MVP enhancements (Summer 2026+): [ LIST FEATURES ]
- [x] No hard deadlines
- [ ] Other: [ YOUR ANSWER HERE ]

**Q49. Can some tasks be developed in parallel?**

**Independent tasks** (can work on simultaneously):
```
you decide based on where changes are taking place (e.g. if only ui changes or only one button is affected)
```

**Blocking dependencies** (X must be done before Y):
```
wait for help before everything isn't done
```

**Q50. MVP Inclusion**: Which of these features should be in MVP vs. post-MVP?

i'm way faster so ignore differentiation

---

## Observations from kp-rück-komplett.png

Based on analyzing the workflow diagram, I noticed these elements that may need attention:

### Workflow Stages
- **Rückfahrt** (return journey) - Is this a distinct status or part of "Einsatz beendet"?
  - part of rückfahrt

- **Einsatzleitung** (incident command) - Should we track incident commander role?
  - no, he'll be in the base in front of the screen/this app

- **Unterwegs** vs. **Einsatz** - Need clearer distinction for "on route" vs. "on scene"?
  - no

### Missing Features from Diagram
1. **Post-incident workflow** - Debriefing, report generation, equipment check?
   - report will be done. rest no

2. **Multi-agency coordination** - Police, ambulance, etc. (future feature?)
   - no

3. **Resource status during operations** - Real-time status updates from field?
   - no

4. **Command hierarchy** - Chain of command, delegation, handoffs?
   - no

5. **Communication logs** - Track intercom/radio communications?
   - too complex

### Additional Features You'd Like Me to Suggest
```
[ Based on the diagram, should I propose additional features not listed in the 6 above?
  If yes, what areas should I focus on? ]
```

---

## Final Thoughts

**Any other requirements, concerns, or ideas not covered above?**
```
[ YOUR ANSWER HERE ]
```

**Questions for me before I start creating task specifications?**
```
[ YOUR ANSWER HERE ]
```

---

## Next Steps

Once you've completed this questionnaire:

1. Save this file
2. Let me know it's ready
3. I will create detailed task specifications following the format of existing tasks (1.1, 6.2, etc.)
4. Each task will include:
   - Implementation steps
   - Code examples
   - Acceptance criteria
   - Time estimates
   - Dependencies
5. You can review and approve before implementation begins

**Thank you for taking the time to provide detailed requirements!**
