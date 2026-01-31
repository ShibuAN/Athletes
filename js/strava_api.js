// Strava API Integration Module
// Handles OAuth, token management, and on-demand activity fetching with caching
// NO DATABASE STORAGE - All data fetched live from Strava API

const StravaAPI = {
    // Cache configuration
    CACHE_TTL: 5 * 60 * 1000, // 5 minutes cache TTL
    CACHE_KEY_PREFIX: 'strava_cache_',

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
            approval_prompt: 'force'
        });
        return `${config.AUTHORIZE_URL}?${params.toString()}`;
    },

    /**
     * Exchange authorization code for access token
     */
    async exchangeToken(code) {
        const config = window.STRAVA_CONFIG;

        try {
            const response = await fetch(config.TOKEN_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
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
     */
    async refreshToken(refreshToken) {
        const config = window.STRAVA_CONFIG;

        try {
            const response = await fetch(config.TOKEN_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
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
     */
    async fetchActivities(accessToken, perPage = 30, options = {}) {
        const config = window.STRAVA_CONFIG;

        try {
            let url = `${config.ACTIVITIES_URL}?per_page=${perPage}`;
            if (options.after) url += `&after=${options.after}`;
            if (options.before) url += `&before=${options.before}`;

            console.log('Fetching Strava URL:', url);
            const response = await fetch(url, {
                headers: { 'Authorization': `Bearer ${accessToken}` }
            });

            if (!response.ok) {
                throw new Error(`Failed to fetch activities: ${response.statusText}`);
            }

            const activities = await response.json();
            console.log(`Fetched ${activities.length} activities from Strava`);
            return activities;
        } catch (error) {
            console.error('Error fetching activities:', error);
            throw error;
        }
    },

    /**
     * Save Strava tokens to Supabase profiles table (tokens only, not activities)
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
     * Normalize Strava activity type to our standard types
     */
    normalizeActivityType(stravaType) {
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
        return typeMap[stravaType] || stravaType.toLowerCase();
    },

    /**
     * Transform Strava activities to our format
     */
    transformActivities(activities, userEmail) {
        return activities.map(act => ({
            user_email: userEmail,
            strava_id: act.id,
            name: act.name,
            type: this.normalizeActivityType(act.type),
            distance: act.distance,
            moving_time: act.moving_time,
            elapsed_time: act.elapsed_time,
            total_elevation_gain: act.total_elevation_gain,
            start_date: act.start_date_local
        }));
    },

    /**
     * Check if token is expired
     */
    isTokenExpired(expiresAt) {
        const now = Math.floor(Date.now() / 1000);
        return now >= (expiresAt - 300); // 5 minute buffer
    },

    /**
     * Get valid access token (refresh if needed)
     */
    async getValidAccessToken(profile) {
        if (!profile.strava_access_token || !profile.strava_refresh_token) {
            throw new Error('No Strava tokens found. Please connect your Strava account.');
        }

        if (this.isTokenExpired(profile.strava_token_expires_at)) {
            console.log('Strava token expired, refreshing...');
            const newTokenData = await this.refreshToken(profile.strava_refresh_token);
            await this.saveTokensToDatabase(profile.email, newTokenData);
            return newTokenData.access_token;
        }

        return profile.strava_access_token;
    },

    // ==========================================
    // ON-DEMAND CACHING METHODS
    // ==========================================

    /**
     * Get cache key for user activities
     */
    getCacheKey(userEmail, suffix = '') {
        return `${this.CACHE_KEY_PREFIX}${userEmail}${suffix ? '_' + suffix : ''}`;
    },

    /**
     * Get cached activities if valid
     */
    getCachedActivities(userEmail, suffix = '') {
        try {
            const key = this.getCacheKey(userEmail, suffix);
            const cached = sessionStorage.getItem(key);

            if (!cached) return null;

            const data = JSON.parse(cached);
            const now = Date.now();

            if (now - data.timestamp > this.CACHE_TTL) {
                sessionStorage.removeItem(key);
                console.log('Cache expired for:', key);
                return null;
            }

            console.log('Using cached data for:', key);
            return data;
        } catch (error) {
            console.error('Cache read error:', error);
            return null;
        }
    },

    /**
     * Save activities to cache
     */
    setCachedActivities(userEmail, activities, suffix = '') {
        try {
            const key = this.getCacheKey(userEmail, suffix);
            const data = {
                activities: activities,
                timestamp: Date.now()
            };
            sessionStorage.setItem(key, JSON.stringify(data));
            console.log('Cached activities for:', key);
        } catch (error) {
            console.error('Cache write error:', error);
        }
    },

    /**
     * Clear cache for a user
     */
    clearCache(userEmail) {
        const keys = Object.keys(sessionStorage).filter(k => k.startsWith(this.getCacheKey(userEmail)));
        keys.forEach(k => sessionStorage.removeItem(k));
        console.log('Cleared cache for:', userEmail);
    },

    /**
     * Fetch activities on-demand with caching (NO DB storage)
     */
    async fetchActivitiesOnDemand(userEmail, profile, options = {}) {
        const cacheKey = options.after ? `range_${options.after}_${options.before || 'now'}` : 'recent';

        // Check cache first (unless force refresh)
        if (!options.forceRefresh) {
            const cached = this.getCachedActivities(userEmail, cacheKey);
            if (cached) {
                return cached.activities;
            }
        }

        try {
            const accessToken = await this.getValidAccessToken(profile);
            const rawActivities = await this.fetchActivities(accessToken, 200, options);
            const activities = this.transformActivities(rawActivities, userEmail);

            // Cache the results (in browser only, not DB)
            this.setCachedActivities(userEmail, activities, cacheKey);

            return activities;
        } catch (error) {
            console.error('Error fetching activities on-demand:', error);
            throw error;
        }
    },

    /**
     * Get activities for dashboard display (on-demand, cached)
     */
    async getDashboardActivities(userEmail, profile, limit = 5) {
        const activities = await this.fetchActivitiesOnDemand(userEmail, profile, {
            forceRefresh: false
        });

        // Sort by date descending and limit
        return activities
            .sort((a, b) => new Date(b.start_date) - new Date(a.start_date))
            .slice(0, limit);
    },

    /**
     * Get activities within a date range (for leaderboard)
     */
    async getActivitiesInRange(userEmail, profile, startDate, endDate) {
        const afterTs = Math.floor(new Date(startDate).getTime() / 1000);
        const beforeTs = Math.floor(new Date(endDate).getTime() / 1000);

        const activities = await this.fetchActivitiesOnDemand(userEmail, profile, {
            after: afterTs,
            before: beforeTs,
            forceRefresh: false
        });

        // Filter to exact date range
        return activities.filter(act => {
            const actDate = new Date(act.start_date);
            return actDate >= new Date(startDate) && actDate <= new Date(endDate);
        });
    },

    /**
     * Get this month's activity count (for dashboard stat)
     */
    async getThisMonthCount(userEmail, profile) {
        const now = new Date();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

        const activities = await this.fetchActivitiesOnDemand(userEmail, profile, {
            after: Math.floor(startOfMonth.getTime() / 1000)
        });

        return activities.filter(a => new Date(a.start_date) >= startOfMonth).length;
    }
};

// Make API globally available
window.StravaAPI = StravaAPI;
