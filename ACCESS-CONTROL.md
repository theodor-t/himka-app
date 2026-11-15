# Access control

The application currently authenticates the fixed `TUDOR` and `DAN` accounts.
Their role is configured on the server with `AUTH_TUDOR_ROLE` and
`AUTH_DAN_ROLE`. Both default to `admin`, matching the current account setup.
Role changes take effect after the server environment is updated and restarted.

Supported roles:

- `admin`: read and write all supported collections.
- `manager`: read and write business data except `employeeProfiles` and
  `systemEvents`.
- `technician`: work with appointments, customers, vehicles, work orders,
  inspections, work posts, services, and warehouse operations; finance and
  employee-administration collections are not returned by the API.
- `readonly`: read all data without write access.

The database API compares submitted collections with the server snapshot and
rejects changes outside the authenticated role's write permissions. Technician
updates preserve finance collections from the server snapshot so empty/redacted
client data cannot erase financial records.
