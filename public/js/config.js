// Feature flags.
// ROOMS_ENABLED: shows the shared-room UI and accepts ?room= links. Keep false until the
// room Worker is deployed with ROOM_SECRET and ALLOWED_ORIGINS set; while false the site
// is the solo timer only and never contacts the room server.
var ROOMS_ENABLED = false;
