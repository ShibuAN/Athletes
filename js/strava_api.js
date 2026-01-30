// Strava API Integration Module
// Handles OAuth, token management, and activity fetching

const StravaAPI = {
    /**
     * Generate the Strava OAuth authorization URL
     */
    getAuthorizationUrl() {
        const config = window.STRAVA_CONFIG;
        const params = new URLSearchParams({
            client_id: config.CLIENT_ID,
            redirect_uri: config.REDIRECT_URI,
            response_type: 'code',
            scope: config.SCOPE,
            approval_prompt: 'force'  // Force account selection every time
        });
        return `${config.AUTHORIZE_URL}?${params.toString()}`;
    },

    /**
     * Exchange authorization code for access token
     * @param {string} code - Authorization code from Strava callback
     * @returns {Promise<Object>} Token response with access_token, refresh_token, etc.
     */
    async exchangeToken(code) {
        const config = window.STRAVA_CONFIG;

        try {
            const response = await fetch(config.TOKEN_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    client_id: config.CLIENT_ID,
                    client_secret: config.CLIENT_SECRET,
                    code: code,
                    grant_type: 'authorization_code'
                })
            });

            if (!response.ok) {
                throw new Error(`Token exchange failed: ${response.statusText}`);
            }

            const data = await response.json();
            console.log('Strava token exchange successful');
            return data;
        } catch (error) {
            console.error('Error exchanging token:', error);
            throw error;
        }
    },

    /**
     * Refresh an expired access token
     * @param {string} refreshToken - The refresh token
     * @returns {Promise<Object>} New token response
     */
    async refreshToken(refreshToken) {
        const config = window.STRAVA_CONFIG;

        try {
            const response = await fetch(config.TOKEN_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    client_id: config.CLIENT_ID,
                    client_secret: config.CLIENT_SECRET,
                    refresh_token: refreshToken,
                    grant_type: 'refresh_token'
                })
            });

            if (!response.ok) {
                throw new Error(`Token refresh failed: ${response.statusText}`);
            }

            const data = await response.json();
            console.log('Strava token refreshed successfully');
            return data;
        } catch (error) {
            console.error('Error refreshing token:', error);
            throw error;
        }
    },

    /**
     * Fetch activities from Strava API
     * @param {string} accessToken - Valid Strava access token
     * @param {number} perPage - Number of activities to fetch (default: 30)
     * @returns {Promise<Array>} Array of activity objects
     */
    async fetchActivities(accessToken, perPage = 30, options = {}) {
        const config = window.STRAVA_CONFIG;

        try {
            let url = `${config.ACTIVITIES_URL}?per_page=${perPage}`;
            if (options.after) url += `&after=${options.after}`;
            if (options.before) url += `&before=${options.before}`;

            console.log('Fetching Strava URL:', url);
            const response = await fetch(url, {
                headers: {
                    'Authorization': `Bearer ${accessToken}`
                }
            });

            if (!response.ok) {
                throw new Error(`Failed to fetch activities: ${response.statusText}`);
            }

            const activities = await response.json();
            console.log(`Fetched ${activities.length} activities from Strava. Range after: ${options.after}, before: ${options.before}`);
            return activities;
        } catch (error) {
            console.error('Error fetching activities:', error);
            throw error;
        }
    },

    /**
     * Save Strava tokens to Supabase profiles table
     * @param {string} userEmail - User's email
     * @param {Object} tokenData - Token data from Strava
     */
    async saveTokensToDatabase(userEmail, tokenData) {
        const supabase = window.supabaseClient;

        try {
            const { error } = await supabase
                .from('profiles')
                .update({
                    strava_access_token: tokenData.access_token,
                    strava_refresh_token: tokenData.refresh_token,
                    strava_token_expires_at: tokenData.expires_at,
                    strava_athlete_id: tokenData.athlete?.id?.toString() || null,
                    strava_connected: true
                })
                .eq('email', userEmail);

            if (error) throw error;
            console.log('Strava tokens saved to database');
        } catch (error) {
            console.error('Error saving tokens to database:', error);
            throw error;
        }
    },

    /**
     * Save activities to Supabase strava_activities table
     * @param {string} userEmail - User's email
     * @param {Array} activities - Array of Strava activities
     */
    async saveActivitiesToDatabase(userEmail, activities) {
        const supabase = window.supabaseClient;

        try {
            // Transform Strava activities to our database format with NORMALIZATION
            const typeMap = {
                'Ride': 'cycling',
                'VirtualRide': 'cycling',
                'E-BikeRide': 'cycling',
                'Run': 'run',
                'VirtualRun': 'run',
                'Walk': 'walk',
                'Hike': 'hiking',
                'Swim': 'swimming'
            };

            const activitiesToSave = activities.map(act => ({
                user_email: userEmail,
                strava_id: act.id,
                name: act.name,
                type: typeMap[act.type] || act.type.toLowerCase(),
                distance: act.distance,
                moving_time: act.moving_time,
                elapsed_time: act.elapsed_time,
                total_elevation_gain: act.total_elevation_gain,
                start_date: act.start_date_local
            }));

            // Use upsert to avoid duplicates and update existing rows
            const { error } = await supabase
                .from('strava_activities')
                .upsert(activitiesToSave, {
                    onConflict: 'strava_id',
                    ignoreDuplicates: false // Set to false to allow updates to existing records
                });

            if (error) throw error;
            console.log(`Saved ${activitiesToSave.length} activities to database`);
        } catch (error) {
            console.error('Error saving activities to database:', error);
            throw error;
        }
    },

    /**
     * Check if token is expired
     * @param {number} expiresAt - Unix timestamp
     * @returns {boolean}
     */
    isTokenExpired(expiresAt) {
        const now = Math.floor(Date.now() / 1000);
        // Add 5 minute buffer
        return now >= (expiresAt - 300);
    },

    /**
     * Get valid access token (refresh if needed)
     * @param {Object} profile - User profile with Strava tokens
     * @returns {Promise<string>} Valid access token
     */
    async getValidAccessToken(profile) {
        if (!profile.strava_access_token || !profile.strava_refresh_token) {
            throw new Error('No Strava tokens found. Please connect your Strava account.');
        }

        // Check if token is expired
        if (this.isTokenExpired(profile.strava_token_expires_at)) {
            console.log('Strava token expired, refreshing...');
            const newTokenData = await this.refreshToken(profile.strava_refresh_token);

            // Save new tokens
            await this.saveTokensToDatabase(profile.email, newTokenData);

            return newTokenData.access_token;
        }

        return profile.strava_access_token;
    },

    /**
     * Complete sync: fetch activities and save to database
     * @param {string} userEmail - User's email
     * @param {Object} profile - User profile object
     * @returns {Promise<Array>} Synced activities
     */
    async syncActivities(userEmail, profile, options = {}) {
        try {
            // Get valid access token (will refresh if expired)
            const accessToken = await this.getValidAccessToken(profile);

            // Fetch activities from Strava
            const activities = await this.fetchActivities(accessToken, 100, options);

            // Save to database
            await this.saveActivitiesToDatabase(userEmail, activities);

            return activities;
        } catch (error) {
            console.error('Error syncing activities:', error);
            throw error;
        }
    }
};

// Make API globally available
window.StravaAPI = StravaAPI;
