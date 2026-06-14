## Phase 3 plan: Implement missing frontend pages for backend REST endpoints

### Information gathered
- Backend exposes REST endpoints:
  - Fields: GET/POST/DELETE `/api/fields` (+ `/api/fields/{field_id}`)
  - Flights: GET/POST/DELETE `/api/flights` (+ `/api/flights/{flight_id}`), and GET `/api/flights/{flight_id}/segmentations`
  - Drones: GET/POST/DELETE `/api/drones` (+ `/api/drones/{drone_id}`)
  - Images: GET `/api/images` and GET/DELETE `/api/images/{image_id}`
  - Analyze: already used by `FarmerAnalyze.tsx` (`/api/analyze/from-storage`)
  - Detections: GET `/api/detections/latest`
- Existing routing lives in `Phytospectra/src/App.tsx` and navigation in `Phytospectra/src/components/Sidebar.tsx`.
- A small auth-aware fetch helper exists: `Phytospectra/src/lib/api.ts` (authedFetch)
- Types exist: `Phytospectra/src/types/backend.ts`

### Plan
1. Add a small typed client for each endpoint using `supabase.auth.getSession()` to supply the JWT.
2. Create new pages:
   - `src/pages/Fields.tsx`
   - `src/pages/Flights.tsx`
   - `src/pages/Drones.tsx`
   - `src/pages/Images.tsx`
   - `src/pages/Segmentations.tsx` (driven by `flight_id` route param)
   - `src/pages/LatestDetections.tsx`
3. Wire routes in `src/App.tsx` and add navigation entries in `src/components/Sidebar.tsx`.
4. Update `TODO.md` checkmarks for implemented steps.

### Dependent files to edit/add
- Add: `Phytospectra/src/pages/*.tsx`
- Edit: `Phytospectra/src/App.tsx`
- Edit: `Phytospectra/src/components/Sidebar.tsx`
- Edit: `Phytospectra/src/lib/backend.ts` or `Phytospectra/src/lib/api.ts` (if needed)
- Edit: `TODO.md`

### Followup steps
- Run the frontend build/test in a reliable way on the user's machine.

