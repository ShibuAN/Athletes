// Strava OAuth Configuration
// Get your credentials from: https://www.strava.com/settings/api

const STRAVA_CONFIG = {
    // Your Strava API credentials
    CLIENT_ID: '193370',
    CLIENT_SECRET: 'fb95d9e6df2ade2702e9c53965993f8bc7d2817c',

    // OAuth settings
    REDIRECT_URI: window.location.origin + '/strava_auth.html',
    SCOPE: 'activity:read_all',

    // API Endpoints
    AUTHORIZE_URL: 'https://www.strava.com/oauth/authorize',
    TOKEN_URL: 'https://www.strava.com/oauth/token',
    ACTIVITIES_URL: 'https://www.strava.com/api/v3/athlete/activities'
};

// Make config globally available
window.STRAVA_CONFIG = STRAVA_CONFIG;

console.log('Strava Config Loaded. Redirect URI:', STRAVA_CONFIG.REDIRECT_URI);
