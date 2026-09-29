'use strict';

const EARTH_RADIUS_M = 6371000;
const rad = (deg) => (deg * Math.PI) / 180;

// Great-circle distance between two coordinates in metres
function distanceMeters(lat1, lon1, lat2, lon2) {
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a));
}

module.exports = { distanceMeters };
