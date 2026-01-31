// Strava API Integration Module
// Handles OAuth, token management, and on-demand activity fetching with caching
// NO DATABASE STORAGE - All data fetched live from Strava API

const StravaAPI = {
    // Cache configuration
    CACHE_TTL: 5 * 60 * 1000, // 5 minutes cache TTL
    CACHE_KEY_PREFIX: 'strava_cache_',

    // Helper: Get start of day (00:00:00) UTC for a date string
    getStartOfDayUTC(dateTimeStr) {
        if (!dateTimeStr) return null;
        let date;
        if (dateTimeStr.includes('T')) {
            date = new Date(dateTimeStr);
        } else {
            const p = dateTimeStr.split(/[-/]/);
            date = new Date(p[0], p[1] - 1, p[2], 0, 0, 0, 0);
        }
        date.setHours(0, 0, 0, 0);
        return isNaN(date.getTime()) ? null : date;
    },

    // Helper: Get end of day (23:59:59) UTC for a date string
    getEndOfDayUTC(dateTimeStr) {
        if (!dateTimeStr) return new Date();
        let date;
        if (dateTimeStr.includes('T')) {
            date = new Date(dateTimeStr);
        } else {
            const p = dateTimeStr.split(/[-/]/);
            date = new Date(p[0], p[1] - 1, p[2], 23, 59, 59, 999);
        }
        date.setHours(23, 59, 59, 999);
        return isNaN(date.getTime()) ? null : date;
    },

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

        // Sort by local date descending and limit
        // a.start_date and b.start_date are start_date_local strings (YYYY-MM-DD...)
        return activities
            .sort((a, b) => b.start_date.localeCompare(a.start_date))
            .slice(0, limit);
    },

    /**
     * Get activities within a date range (for leaderboard)
     */
    async getActivitiesInRange(userEmail, profile, startDate, endDate) {
        const startObj = this.getStartOfDayUTC(startDate);
        const endObj = this.getEndOfDayUTC(endDate);

        if (!startObj) return [];

        // Exact UTC timestamps
        const afterTs = Math.floor(startObj.getTime() / 1000);
        const beforeTs = Math.floor(endObj.getTime() / 1000);

        const activities = await this.fetchActivitiesOnDemand(userEmail, profile, {
            after: afterTs,
            before: beforeTs,
            forceRefresh: false
        });

        // Filter to exact UTC range
        const startTs = startObj.getTime();
        const endTs = endObj.getTime();

        return activities.filter(act => {
            const actTs = new Date(act.start_date).getTime();
            return actTs >= startTs && actTs <= endTs;
        });
    },

    /**
     * Get this month's activity count (for dashboard stat)
     */
    async getThisMonthCount(userEmail, profile) {
        const now = new Date();
        const year = now.getFullYear();
        const month = now.getMonth();

        // Start of month in Local (to get the right day/month)
        const startOfMonthStr = `${year}-${String(month + 1).padStart(2, '0')}-01`;

        // But we fetch from Strava using UTC with a buffer
        const startOfMonthUTC = this.getStartOfDayUTC(startOfMonthStr);
        if (!startOfMonthUTC) return 0;

        const afterTs = Math.floor(startOfMonthUTC.getTime() / 1000) - 86400; // 24h buffer

        const activities = await this.fetchActivitiesOnDemand(userEmail, profile, {
            after: afterTs
        });

        // Filter using Local Date string
        return activities.filter(a => {
            const actDateStr = a.start_date.substring(0, 10);
            return actDateStr >= startOfMonthStr;
        }).length;
    },

    // ==========================================
    // EVENT-SPECIFIC TABLE SYNC METHODS
    // ==========================================

    /**
     * Get user's active event registrations with event details
     */
    async getUserActiveEventRegistrations(userEmail) {
        const supabase = window.supabaseClient;

        try {
            // Get registrations for active events where user has paid
            const { data: registrations, error } = await supabase
                .from('event_registrations')
                .select(`
                    event_id,
                    events (
                        id,
                        name,
                        start_date,
                        end_date,
                        is_active,
                        activity_table_name,
                        activity_table_created
                    )
                `)
                .eq('user_email', userEmail)
                .eq('payment_status', 'paid');

            if (error) {
                console.error('Error fetching registrations:', error);
                return [];
            }

            // Filter to active events that have started
            const activeEvents = registrations
                .filter(r => r.events && r.events.is_active)
                .filter(r => new Date(r.events.start_date) <= new Date())
                .filter(r => !r.events.end_date || new Date(r.events.end_date) >= new Date())
                .map(r => r.events);

            console.log('User active events:', activeEvents);
            return activeEvents;
        } catch (error) {
            console.error('Error getting user events:', error);
            return [];
        }
    },

    /**
     * Ensure event activity table exists (create if event has started)
     */
    async ensureEventTableExists(eventId) {
        const supabase = window.supabaseClient;

        try {
            // Call the database function to create table if needed
            const { data, error } = await supabase.rpc('create_event_activity_table', {
                event_id: eventId
            });

            if (error) {
                console.error('Error creating event table:', error);
                return null;
            }

            console.log('Event table ensured:', data);
            return data; // Returns table name
        } catch (error) {
            console.error('Error ensuring event table:', error);
            return null;
        }
    },

    /**
     * Sync activities to event-specific table
     */
    async syncActivitiesToEventTable(userEmail, profile, event) {
        const supabase = window.supabaseClient;

        try {
            // Ensure table exists
            let tableName = event.activity_table_name;
            if (!tableName || !event.activity_table_created) {
                tableName = await this.ensureEventTableExists(event.id);
                if (!tableName) {
                    throw new Error('Could not create event activity table');
                }
            }

            console.log(`Syncing activities to table: ${tableName}`);

            // Get event date range
            const eventStartDate = event.start_date.substring(0, 10);
            const eventEndDate = event.end_date ? event.end_date.substring(0, 10) : new Date().toISOString().substring(0, 10);

            // Fetch activities from Strava for event period (with precise UTC conversion)
            const startObj = this.getStartOfDayUTC(event.start_date);
            const endObj = this.getEndOfDayUTC(event.end_date || new Date().toISOString());

            const afterTs = Math.floor(startObj.getTime() / 1000);
            const beforeTs = Math.floor(endObj.getTime() / 1000);

            const accessToken = await this.getValidAccessToken(profile);
            const rawActivities = await this.fetchActivities(accessToken, 200, {
                after: afterTs,
                before: beforeTs
            });

            if (!rawActivities || rawActivities.length === 0) {
                console.log('No activities found for event period');
                return { synced: 0, skipped: 0 };
            }

            // Transform and filter activities
            const startTs = startObj.getTime();
            const endTs = endObj.getTime();

            const activities = rawActivities
                .filter(act => {
                    // Compare using UTC timestamp
                    const actTs = new Date(act.start_date).getTime();
                    return actTs >= startTs && actTs <= endTs;
                })
                .map(act => ({
                    user_email: userEmail,
                    strava_id: act.id,
                    activity_name: act.name,
                    activity_type: this.normalizeActivityType(act.type),
                    activity_date: act.start_date_local.substring(0, 10), // YYYY-MM-DD
                    distance: act.distance || 0,
                    elevation: act.total_elevation_gain || 0,
                    moving_time: act.moving_time || 0
                }));

            console.log(`Found ${activities.length} activities to sync`);

            // Upsert activities to event table (using raw SQL via RPC or direct insert)
            let synced = 0;
            let skipped = 0;

            for (const activity of activities) {
                // Try to insert, on conflict update
                const { error } = await supabase
                    .from(tableName)
                    .upsert(activity, {
                        onConflict: 'strava_id',
                        ignoreDuplicates: false
                    });

                if (error) {
                    console.warn(`Failed to sync activity ${activity.strava_id}:`, error.message);
                    skipped++;
                } else {
                    synced++;
                }
            }

            console.log(`Sync complete: ${synced} synced, ${skipped} skipped`);
            return { synced, skipped, tableName };
        } catch (error) {
            console.error('Error syncing to event table:', error);
            throw error;
        }
    },

    /**
     * Auto-sync activities for all user's active events
     * Call this when user visits dashboard
     */
    async autoSyncUserActivities(userEmail, profile) {
        try {
            console.log('Starting auto-sync for user:', userEmail);

            // Get user's active event registrations
            const activeEvents = await this.getUserActiveEventRegistrations(userEmail);

            if (activeEvents.length === 0) {
                console.log('No active events to sync');
                return { events: 0, totalSynced: 0 };
            }

            const results = [];

            for (const event of activeEvents) {
                try {
                    const result = await this.syncActivitiesToEventTable(userEmail, profile, event);
                    results.push({
                        eventName: event.name,
                        ...result
                    });
                } catch (err) {
                    console.error(`Failed to sync for event ${event.name}:`, err);
                    results.push({
                        eventName: event.name,
                        error: err.message
                    });
                }
            }

            const totalSynced = results.reduce((sum, r) => sum + (r.synced || 0), 0);
            console.log('Auto-sync complete:', results);

            return {
                events: activeEvents.length,
                totalSynced,
                details: results
            };
        } catch (error) {
            console.error('Auto-sync error:', error);
            throw error;
        }
    },

    /**
     * Get activities from event table (for leaderboard)
     */
    async getActivitiesFromEventTable(tableName) {
        const supabase = window.supabaseClient;

        try {
            const { data, error } = await supabase
                .from(tableName)
                .select('*')
                .order('activity_date', { ascending: false });

            if (error) {
                console.error('Error fetching from event table:', error);
                return [];
            }

            return data || [];
        } catch (error) {
            console.error('Error getting activities from event table:', error);
            return [];
        }
    }
};

// Make API globally available
window.StravaAPI = StravaAPI;
