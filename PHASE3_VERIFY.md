Quick verification checklist

- Routes exist:
  - /fields -> Fields page
  - /flights -> Flights page
  - /drones -> Drones page
  - /images -> Images page
  - /segmentations/:flight_id -> Segmentations page
  - /detections/latest -> LatestDetections page

- Sidebar links exist for farmer role:
  - /fields, /flights, /drones, /detections/latest

- Backend auth expectation:
  - Pages use supabase.auth.getSession() to pull access_token.
  - They send Authorization: Bearer <token>.

Potential follow-ups:
- If typescript/lint fails, adjust eslint-disable or any strict checks.
- If backend returns errors, show res.text.

