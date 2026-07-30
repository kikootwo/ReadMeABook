# Specification: Request State Recovery

## ADDED Requirements

### Requirement: Automatic Timeout Detection
The system MUST periodically inspect requests in `searching` or `processing` status that have not been updated for over 2 hours.

#### Scenario: Resetting stuck searching request
- **GIVEN** a request in `searching` status with `updatedAt` 3 hours ago
- **WHEN** `recover_stuck_requests` processor executes
- **THEN** the request status MUST be updated to `awaiting_search` and logged in `jobEvent` history.

#### Scenario: Preserving active downloads
- **GIVEN** a request in `processing` status with `updatedAt` 3 hours ago and valid `downloadId`
- **AND** SABnzbd confirms the `downloadId` is actively downloading
- **WHEN** `recover_stuck_requests` processor executes
- **THEN** the request status MUST be updated to `downloading` rather than `awaiting_search`.

### Requirement: Admin UI Recovery Action
Admins MUST be able to trigger immediate stuck request state recovery from the Operations Center UI.

#### Scenario: Admin clicks Reset Stuck Requests
- **GIVEN** an authenticated admin user on `/admin/settings`
- **WHEN** the user clicks "Reset Stuck Requests"
- **THEN** the system MUST execute `recover_stuck_requests` and display the count of recovered requests.
