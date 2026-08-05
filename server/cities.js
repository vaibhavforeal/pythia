// Small built-in city gazetteer for the birth-details quick-pick.
// Each entry: [name, latitude, longitude, standardUtcOffsetHours, aka?].
// NOTE: offsets are STANDARD time. Historical daylight-saving is not applied —
// users born during DST should nudge the offset by 1 hour manually.
//
// `aka` carries the spelling people actually type. The upstream geocoder indexes
// official names only, so "Bangalore" used to return a town in Sindh and miss
// the city of eight million entirely. Most of India's renames are recent enough
// that the old name is still the common one — and someone entering a BIRTH place
// is by definition naming somewhere as it was called decades ago, so the old
// spelling is the likelier input here, not the rarer one.

const CITIES = [
  // --- India ---
  ["New Delhi, India", 28.6139, 77.2090, 5.5],
  ["Mumbai, India", 19.0760, 72.8777, 5.5, ["Bombay"]],
  ["Bengaluru, India", 12.9716, 77.5946, 5.5, ["Bangalore"]],
  ["Chennai, India", 13.0827, 80.2707, 5.5, ["Madras"]],
  ["Kolkata, India", 22.5726, 88.3639, 5.5, ["Calcutta"]],
  ["Hyderabad, India", 17.3850, 78.4867, 5.5],
  ["Pune, India", 18.5204, 73.8567, 5.5, ["Poona"]],
  ["Ahmedabad, India", 23.0225, 72.5714, 5.5],
  ["Jaipur, India", 26.9124, 75.7873, 5.5],
  ["Lucknow, India", 26.8467, 80.9462, 5.5],
  ["Varanasi, India", 25.3176, 82.9739, 5.5, ["Banaras", "Benares", "Kashi"]],
  ["Chandigarh, India", 30.7333, 76.7794, 5.5],
  ["Kochi, India", 9.9312, 76.2673, 5.5, ["Cochin"]],
  ["Nagpur, India", 21.1458, 79.0882, 5.5],
  ["Patna, India", 25.5941, 85.1376, 5.5],
  ["Bhopal, India", 23.2599, 77.4126, 5.5],
  ["Guwahati, India", 26.1445, 91.7362, 5.5, ["Gauhati"]],
  ["Amritsar, India", 31.6340, 74.8723, 5.5],
  ["Surat, India", 21.1702, 72.8311, 5.5],
  ["Indore, India", 22.7196, 75.8577, 5.5],
  ["Coimbatore, India", 11.0168, 76.9558, 5.5],
  ["Thiruvananthapuram, India", 8.5241, 76.9366, 5.5, ["Trivandrum"]],
  ["Vadodara, India", 22.3072, 73.1812, 5.5, ["Baroda"]],
  ["Prayagraj, India", 25.4358, 81.8463, 5.5, ["Allahabad"]],
  ["Puducherry, India", 11.9416, 79.8083, 5.5, ["Pondicherry", "Pondy"]],
  ["Visakhapatnam, India", 17.6868, 83.2185, 5.5, ["Vizag", "Vishakhapatnam"]],
  ["Gurugram, India", 28.4595, 77.0266, 5.5, ["Gurgaon"]],
  ["Madurai, India", 9.9252, 78.1198, 5.5],
  ["Tiruchirappalli, India", 10.7905, 78.7047, 5.5, ["Trichy", "Trichinopoly"]],
  ["Bhubaneswar, India", 20.2961, 85.8245, 5.5],
  ["Dehradun, India", 30.3165, 78.0322, 5.5],
  ["Nashik, India", 19.9975, 73.7898, 5.5, ["Nasik"]],
  // --- Karnataka, where the old spellings are still in daily use ---
  ["Shivamogga, India", 13.9299, 75.5681, 5.5, ["Shimoga"]],
  ["Mysuru, India", 12.2958, 76.6394, 5.5, ["Mysore"]],
  ["Mangaluru, India", 12.9141, 74.8560, 5.5, ["Mangalore"]],
  ["Hubballi, India", 15.3647, 75.1240, 5.5, ["Hubli"]],
  ["Belagavi, India", 15.8497, 74.4977, 5.5, ["Belgaum"]],
  ["Kalaburagi, India", 17.3297, 76.8343, 5.5, ["Gulbarga"]],
  ["Ballari, India", 15.1394, 76.9214, 5.5, ["Bellary"]],
  ["Vijayapura, India", 16.8302, 75.7100, 5.5, ["Bijapur"]],
  ["Tumakuru, India", 13.3409, 77.1010, 5.5, ["Tumkur"]],
  ["Davangere, India", 14.4644, 75.9218, 5.5],
  ["Udupi, India", 13.3409, 74.7421, 5.5],
  ["Chikkamagaluru, India", 13.3161, 75.7720, 5.5, ["Chikmagalur"]],
  // --- South Asia / neighbours ---
  ["Kathmandu, Nepal", 27.7172, 85.3240, 5.75],
  ["Colombo, Sri Lanka", 6.9271, 79.8612, 5.5],
  ["Dhaka, Bangladesh", 23.8103, 90.4125, 6.0],
  ["Karachi, Pakistan", 24.8607, 67.0011, 5.0],
  ["Lahore, Pakistan", 31.5204, 74.3587, 5.0],
  // --- Rest of the world ---
  ["Dubai, UAE", 25.2048, 55.2708, 4.0],
  ["London, UK", 51.5074, -0.1278, 0.0],
  ["New York, USA", 40.7128, -74.0060, -5.0],
  ["Los Angeles, USA", 34.0522, -118.2437, -8.0],
  ["Chicago, USA", 41.8781, -87.6298, -6.0],
  ["San Francisco, USA", 37.7749, -122.4194, -8.0],
  ["Houston, USA", 29.7604, -95.3698, -6.0],
  ["Toronto, Canada", 43.6532, -79.3832, -5.0],
  ["Singapore", 1.3521, 103.8198, 8.0],
  ["Kuala Lumpur, Malaysia", 3.1390, 101.6869, 8.0],
  ["Hong Kong", 22.3193, 114.1694, 8.0],
  ["Tokyo, Japan", 35.6762, 139.6503, 9.0],
  ["Sydney, Australia", -33.8688, 151.2093, 10.0],
  ["Nairobi, Kenya", -1.2921, 36.8219, 3.0],
  ["Johannesburg, South Africa", -26.2041, 28.0473, 2.0]
].map(([name, lat, lon, tz, aka = []]) => {
  // City and country are split out because only the city is searchable. Matching
  // the whole "Bengaluru, India" string meant every prefix of "India" matched
  // every Indian entry — enough to fill the response and hide real towns the
  // geocoder had found. Entries without a comma (Singapore, Hong Kong) are all
  // city.
  const i = name.lastIndexOf(", ");
  return {
    name,
    city: i === -1 ? name : name.slice(0, i),
    country: i === -1 ? "" : name.slice(i + 2),
    lat, lon, tz, aka
  };
});

module.exports = { CITIES };
