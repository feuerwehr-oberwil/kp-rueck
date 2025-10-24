# Configuration Settings Summary

This document outlines all hardcoded vs. configurable settings in the KP Rück system.

## Configurable Settings (End-User Manageable)

These settings will be managed through the Settings API and stored in the `settings` table:

### 1. **Incident Types**
- **Purpose:** Categories of emergency incidents
- **Values (German):**
  1. `brandbekaempfung` - Brandbekämpfung
  2. `elementarereignis` - Elementarereignis
  3. `strassenrettung` - Strassenrettung
  4. `technische_hilfeleistung` - Technische Hilfeleistung/Pioniereinsatz
  5. `oelwehr` - Ölwehr
  6. `chemiewehr` - Chemiewehr inkl. B-Einsätze
  7. `strahlenwehr` - Strahlenwehr
  8. `einsatz_bahnanlagen` - Einsatz auf Bahnanlagen
  9. `bma_unechte_alarme` - BMA (unechte Alarme)
  10. `dienstleistungen` - Dienstleistungen (nicht alarmmässig)
  11. `diverse_einsaetze` - Diverse Einsätze (alarmmässig)
  12. `gerettete_menschen` - Gerettete Menschen
  13. `gerettete_tiere` - Gerettete Tiere

- **Implementation:** Stored as JSON array in settings table
- **Setting Key:** `incident_types`

### 2. **Incident Priority Levels**
- **Purpose:** Priority/urgency classification
- **Default Values:**
  - `low` - Low priority
  - `medium` - Medium priority
  - `high` - High priority
  - `critical` - Critical priority

- **Implementation:** Stored as JSON array in settings table
- **Setting Key:** `incident_priorities`

### 3. **Vehicle Types**
- **Purpose:** Types of fire apparatus and vehicles
- **Example Values:**
  - `TLF` - Tanklöschfahrzeug
  - `DLK` - Drehleiter
  - `MTW` - Mannschaftstransportwagen
  - `Pionier` - Pionierfahrzeug
  - `Kommando` - Kommandowagen

- **Implementation:** Stored as JSON array in settings table
- **Setting Key:** `vehicle_types`

### 4. **Personnel Roles**
- **Purpose:** Roles/qualifications for firefighters
- **Example Values:**
  - `Fahrer` - Driver
  - `Reko/EL/FU` - Reconnaissance/Unit Leader/Radio Operator
  - `Mannschaft` - Crew Member
  - `Gruppenführer` - Group Leader
  - `Maschinist` - Engineer/Pump Operator

- **Implementation:** Stored as JSON array in settings table
- **Setting Key:** `personnel_roles`

---

## Hardcoded Settings (System-Level, Not Configurable)

These settings are enforced at the database constraint level and tied to business logic:

### 1. **Vehicle Status**
- **Values:** `available`, `assigned`, `planned`, `maintenance`
- **Location:** `backend/app/models.py:81` (CheckConstraint)
- **Rationale:** Core to resource assignment logic

### 2. **Personnel Availability**
- **Values:** `available`, `assigned`, `unavailable`
- **Location:** `backend/app/models.py:102` (CheckConstraint)
- **Rationale:** Core to resource assignment logic

### 3. **Material Status**
- **Values:** `available`, `assigned`, `planned`, `maintenance`
- **Location:** `backend/app/models.py:123` (CheckConstraint)
- **Rationale:** Core to resource assignment logic

### 4. **Incident Status (Kanban Workflow)**
- **Values:** `eingegangen`, `reko`, `disponiert`, `einsatz`, `einsatz_beendet`, `abschluss`
- **Location:** `backend/app/models.py:181` (CheckConstraint)
- **Rationale:** Core workflow stages with business logic tied to transitions

### 5. **User Roles**
- **Values:** `editor`, `viewer`
- **Location:** `backend/app/models.py:57` (CheckConstraint)
- **Rationale:** Security/authorization model

### 6. **Resource Assignment Types**
- **Values:** `personnel`, `vehicle`, `material`
- **Location:** `backend/app/models.py:222` (CheckConstraint)
- **Rationale:** Core data model structure

---

## Material Type Handling

**Decision:** Materials do NOT have a separate `type` field.

- **Implementation:** Material names should be descriptive and include type/source information
- **Example:**
  - ❌ Old: `type: "Pumpen"`, `name: "TP 15/8"`
  - ✅ New: `name: "Wasserpumpe TP 15/8 from TLF 1"`

- **Rationale:** Materials are inherently tied to their location (vehicle or storage), so the name field should be descriptive enough to identify both type and source.

---

## Database Schema Changes Required

### Migration: Add `planned` status + Remove material `type` column

**Tables affected:**
1. `vehicles` - Add `planned` to status constraint
2. `materials` - Add `planned` to status constraint, DROP `type` column

**Files to update:**
1. `backend/app/models.py` ✅ (Done)
2. `backend/app/schemas.py` ✅ (Done)
3. `backend/app/seed.py` ✅ (Done)
4. Create Alembic migration ⏳ (TODO)

---

## Implementation Notes

### Validation Strategy

For configurable settings:
- Store as JSON arrays in `settings` table
- Validate against stored values in API layer (Pydantic validators)
- Provide admin UI to manage these lists
- Include default values in database seed

### Migration Path

1. Create migration to:
   - Alter vehicle status constraint to include `planned`
   - Alter material status constraint to include `planned`
   - Drop `materials.type` column

2. Update seed data with new material names (descriptive)

3. Update frontend to fetch configurable values from Settings API

---

**Last Updated:** 2025-10-24
**Status:** Schema changes complete, migration pending
