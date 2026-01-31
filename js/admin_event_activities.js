// Admin Event Activities Management
document.addEventListener('DOMContentLoaded', async () => {
    const supabase = window.supabaseClient;

    // State
    let currentEventId = null;
    let currentTableName = null;
    let deleteCallback = null;

    // DOM Elements
    const eventsGrid = document.getElementById('eventsGrid');
    const activitiesModal = document.getElementById('activitiesModal');
    const deleteModal = document.getElementById('deleteModal');
    const toast = document.getElementById('toast');

    // Check Admin Access
    async function checkAdmin() {
        const { data: { session } } = await supabase.auth.getSession();

        if (!session) {
            window.location.href = 'login.html';
            return false;
        }

        const { data, error } = await supabase
            .from('profiles')
            .select('role')
            .eq('email', session.user.email)
            .single();

        if (error || data?.role !== 'admin') {
            alert('Access Denied. Admins only.');
            await supabase.auth.signOut();
            window.location.href = 'index.html';
            return false;
        }

        return true;
    }

    // Show Toast
    function showToast(message, type = 'success') {
        toast.textContent = message;
        toast.className = `toast ${type} show`;
        setTimeout(() => {
            toast.classList.remove('show');
        }, 3000);
    }

    // Load Events
    async function loadEvents() {
        eventsGrid.innerHTML = '<div class="empty-state"><i class="fas fa-spinner fa-spin"></i><p>Loading events...</p></div>';

        try {
            const { data: events, error } = await supabase
                .from('events')
                .select('*')
                .order('start_date', { ascending: false });

            if (error) throw error;

            if (!events || events.length === 0) {
                eventsGrid.innerHTML = '<div class="empty-state"><i class="fas fa-calendar-xmark"></i><p>No events found</p></div>';
                return;
            }

            // Get activity counts for each event with a table
            const eventsWithStats = await Promise.all(events.map(async (event) => {
                let activityCount = 0;
                let userCount = 0;

                if (event.activity_table_name && event.activity_table_created) {
                    try {
                        const { count, error: countError } = await supabase
                            .from(event.activity_table_name)
                            .select('*', { count: 'exact', head: true });

                        if (!countError) {
                            activityCount = count || 0;
                        }

                        // Get unique users
                        const { data: users } = await supabase
                            .from(event.activity_table_name)
                            .select('user_email');

                        if (users) {
                            userCount = new Set(users.map(u => u.user_email)).size;
                        }
                    } catch (e) {
                        console.warn(`Could not get stats for ${event.activity_table_name}:`, e);
                    }
                }

                return { ...event, activityCount, userCount };
            }));

            renderEvents(eventsWithStats);
        } catch (error) {
            console.error('Error loading events:', error);
            eventsGrid.innerHTML = '<div class="empty-state"><i class="fas fa-exclamation-circle"></i><p>Error loading events</p></div>';
        }
    }

    // Render Events
    function renderEvents(events) {
        eventsGrid.innerHTML = events.map(event => {
            const hasTable = event.activity_table_created && event.activity_table_name;
            const eventStarted = new Date(event.start_date) <= new Date();
            const eventEnded = event.end_date && new Date(event.end_date) < new Date();

            let statusClass = 'status-none';
            let statusText = 'No Table';

            if (hasTable) {
                statusClass = 'status-active';
                statusText = 'Table Active';
            } else if (eventStarted) {
                statusClass = 'status-pending';
                statusText = 'Ready to Create';
            }

            const startDate = new Date(event.start_date).toLocaleDateString();
            const endDate = event.end_date ? new Date(event.end_date).toLocaleDateString() : 'N/A';

            return `
                <div class="event-card">
                    <div class="event-card-header">
                        <h3 class="event-card-title">${event.name}</h3>
                        <span class="table-status ${statusClass}">${statusText}</span>
                    </div>

                    <div class="event-card-info">
                        <p><i class="fas fa-calendar"></i> ${startDate} - ${endDate}</p>
                        ${hasTable ? `<p><i class="fas fa-database"></i> ${event.activity_table_name}</p>` : ''}
                    </div>

                    ${hasTable ? `
                        <div class="event-card-stats">
                            <div class="stat-item">
                                <div class="stat-value">${event.activityCount}</div>
                                <div class="stat-label">Activities</div>
                            </div>
                            <div class="stat-item">
                                <div class="stat-value">${event.userCount}</div>
                                <div class="stat-label">Users</div>
                            </div>
                        </div>
                    ` : ''}

                    <div class="event-card-actions">
                        ${hasTable ? `
                            <button class="btn btn-primary btn-sm" onclick="viewActivities('${event.id}', '${event.activity_table_name}', '${event.name.replace(/'/g, "\\'")}')">
                                <i class="fas fa-list"></i> View Activities
                            </button>
                            <button class="btn btn-secondary btn-sm" onclick="forceSyncAllUsers('${event.id}', '${event.activity_table_name}', '${event.name.replace(/'/g, "\\'")}', '${event.start_date}', '${event.end_date || ''}')">
                                <i class="fas fa-sync"></i> Force Sync All
                            </button>
                            <button class="btn btn-danger btn-sm" onclick="confirmDeleteTable('${event.id}', '${event.activity_table_name}', '${event.name.replace(/'/g, "\\'")}')">
                                <i class="fas fa-trash"></i> Delete Table
                            </button>
                        ` : eventStarted ? `
                            <button class="btn btn-primary btn-sm" onclick="createTable('${event.id}')">
                                <i class="fas fa-plus"></i> Create Table
                            </button>
                        ` : `
                            <span style="color: var(--text-muted); font-size: 0.85rem;">
                                <i class="fas fa-clock"></i> Event not started yet
                            </span>
                        `}
                    </div>
                </div>
            `;
        }).join('');
    }

    // Create Table
    window.createTable = async (eventId) => {
        try {
            showToast('Creating table...', 'success');

            const { data, error } = await supabase.rpc('create_event_activity_table', {
                event_id: eventId
            });

            if (error) throw error;

            showToast(`Table created: ${data}`, 'success');
            loadEvents();
        } catch (error) {
            console.error('Error creating table:', error);
            showToast('Error creating table: ' + error.message, 'error');
        }
    };

    // View Activities
    window.viewActivities = async (eventId, tableName, eventName) => {
        currentEventId = eventId;
        currentTableName = tableName;

        document.getElementById('modalTitle').textContent = `Activities: ${eventName}`;
        document.getElementById('modalSubtitle').textContent = `Table: ${tableName}`;

        activitiesModal.classList.add('show');
        resetActivityForm();
        await loadActivities();
    };

    // Load Activities
    async function loadActivities() {
        const tbody = document.getElementById('activitiesTableBody');
        tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; padding: 2rem;"><i class="fas fa-spinner fa-spin"></i> Loading...</td></tr>';

        try {
            const { data, error } = await supabase
                .from(currentTableName)
                .select('*')
                .order('activity_date', { ascending: false });

            if (error) throw error;

            if (!data || data.length === 0) {
                tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; padding: 2rem; color: var(--text-muted);">No activities yet</td></tr>';
                return;
            }

            tbody.innerHTML = data.map(act => `
                <tr>
                    <td>${act.user_email}</td>
                    <td>${act.activity_name || '-'}</td>
                    <td>
                        <span class="activity-type-badge type-${act.activity_type}">${act.activity_type}</span>
                    </td>
                    <td>${act.activity_date}</td>
                    <td>${((act.distance || 0) / 1000).toFixed(2)} km</td>
                    <td>${act.elevation || 0} m</td>
                    <td>
                        <button class="btn btn-outline btn-sm" onclick='editActivity(${JSON.stringify(act)})' style="padding: 0.25rem 0.5rem; font-size: 0.75rem;">
                            <i class="fas fa-edit"></i>
                        </button>
                        <button class="btn btn-danger btn-sm" onclick="confirmDeleteActivity('${act.id}')" style="padding: 0.25rem 0.5rem; font-size: 0.75rem;">
                            <i class="fas fa-trash"></i>
                        </button>
                    </td>
                </tr>
            `).join('');
        } catch (error) {
            console.error('Error loading activities:', error);
            tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; color: #ef4444;">Error loading activities</td></tr>';
        }
    }

    // Save Activity (Add/Update)
    window.saveActivity = async () => {
        const editId = document.getElementById('editActivityId').value;
        const userEmail = document.getElementById('actUserEmail').value.trim();
        const stravaId = document.getElementById('actStravaId').value.trim();
        const activityName = document.getElementById('actName').value.trim();
        const activityType = document.getElementById('actType').value;
        const activityDate = document.getElementById('actDate').value;
        const distance = parseFloat(document.getElementById('actDistance').value) || 0;
        const elevation = parseFloat(document.getElementById('actElevation').value) || 0;

        if (!userEmail || !stravaId || !activityType || !activityDate) {
            showToast('Please fill all required fields', 'error');
            return;
        }

        const activityData = {
            user_email: userEmail,
            strava_id: parseInt(stravaId),
            activity_name: activityName,
            activity_type: activityType,
            activity_date: activityDate,
            distance: distance,
            elevation: elevation
        };

        try {
            if (editId) {
                // Update
                const { error } = await supabase
                    .from(currentTableName)
                    .update(activityData)
                    .eq('id', editId);

                if (error) throw error;
                showToast('Activity updated successfully', 'success');
            } else {
                // Insert
                const { error } = await supabase
                    .from(currentTableName)
                    .insert([activityData]);

                if (error) throw error;
                showToast('Activity added successfully', 'success');
            }

            resetActivityForm();
            loadActivities();
        } catch (error) {
            console.error('Error saving activity:', error);
            showToast('Error: ' + error.message, 'error');
        }
    };

    // Edit Activity
    window.editActivity = (activity) => {
        document.getElementById('editActivityId').value = activity.id;
        document.getElementById('actUserEmail').value = activity.user_email;
        document.getElementById('actStravaId').value = activity.strava_id;
        document.getElementById('actName').value = activity.activity_name || '';
        document.getElementById('actType').value = activity.activity_type;
        document.getElementById('actDate').value = activity.activity_date;
        document.getElementById('actDistance').value = activity.distance || '';
        document.getElementById('actElevation').value = activity.elevation || '';

        document.getElementById('saveActivityBtnText').textContent = 'Update';
        document.getElementById('cancelEditBtn').style.display = 'inline-flex';
    };

    // Reset Activity Form
    window.resetActivityForm = () => {
        document.getElementById('editActivityId').value = '';
        document.getElementById('actUserEmail').value = '';
        document.getElementById('actStravaId').value = '';
        document.getElementById('actName').value = '';
        document.getElementById('actType').value = '';
        document.getElementById('actDate').value = '';
        document.getElementById('actDistance').value = '';
        document.getElementById('actElevation').value = '';

        document.getElementById('saveActivityBtnText').textContent = 'Add';
        document.getElementById('cancelEditBtn').style.display = 'none';
    };

    // Confirm Delete Activity
    window.confirmDeleteActivity = (activityId) => {
        document.getElementById('deleteMessage').textContent = 'Are you sure you want to delete this activity?';
        deleteCallback = async () => {
            try {
                const { error } = await supabase
                    .from(currentTableName)
                    .delete()
                    .eq('id', activityId);

                if (error) throw error;

                showToast('Activity deleted', 'success');
                closeDeleteModal();
                loadActivities();
            } catch (error) {
                showToast('Error: ' + error.message, 'error');
            }
        };
        deleteModal.classList.add('show');
    };

    // Confirm Delete Table
    window.confirmDeleteTable = (eventId, tableName, eventName) => {
        document.getElementById('deleteMessage').innerHTML = `
            Are you sure you want to delete the activity table for <strong>"${eventName}"</strong>?
            <br><br>
            <span style="color: #ef4444;">This will permanently delete ALL activity data for this event!</span>
        `;
        deleteCallback = async () => {
            try {
                const { error } = await supabase.rpc('delete_event_activity_table', {
                    event_id: eventId
                });

                if (error) throw error;

                showToast('Table deleted successfully', 'success');
                closeDeleteModal();
                loadEvents();
            } catch (error) {
                showToast('Error: ' + error.message, 'error');
            }
        };
        deleteModal.classList.add('show');
    };

    // Close Modal
    window.closeModal = () => {
        activitiesModal.classList.remove('show');
        currentEventId = null;
        currentTableName = null;
    };

    // Close Delete Modal
    window.closeDeleteModal = () => {
        deleteModal.classList.remove('show');
        deleteCallback = null;
    };

    // Force Sync All Users
    window.forceSyncAllUsers = async (eventId, tableName, eventName, startDate, endDate) => {
        showToast('Starting sync for all users...', 'success');

        try {
            // Get all paid registrations for this event
            const { data: registrations, error: regError } = await supabase
                .from('event_registrations')
                .select('user_email')
                .eq('event_id', eventId)
                .eq('payment_status', 'paid');

            if (regError) throw regError;

            if (!registrations || registrations.length === 0) {
                showToast('No paid registrations found for this event', 'error');
                return;
            }

            showToast(`Found ${registrations.length} registered users. Syncing...`, 'success');

            let syncedCount = 0;
            let errorCount = 0;
            let noStravaCount = 0;

            // Process each user
            for (const reg of registrations) {
                try {
                    // Get user's Strava tokens
                    const { data: profile, error: profileError } = await supabase
                        .from('profiles')
                        .select('strava_access_token, strava_refresh_token, strava_token_expires_at, strava_athlete_id')
                        .eq('email', reg.user_email)
                        .single();

                    if (profileError || !profile || !profile.strava_access_token) {
                        noStravaCount++;
                        continue;
                    }

                    // Check if token needs refresh
                    let accessToken = profile.strava_access_token;
                    const expiresAt = profile.strava_token_expires_at;

                    if (expiresAt && Date.now() / 1000 > expiresAt) {
                        // Token expired, need to refresh
                        const refreshed = await refreshStravaToken(reg.user_email, profile.strava_refresh_token);
                        if (refreshed) {
                            accessToken = refreshed;
                        } else {
                            errorCount++;
                            continue;
                        }
                    }

                    // Fetch activities from Strava
                    const activities = await fetchStravaActivities(accessToken, startDate, endDate);

                    if (activities && activities.length > 0) {
                        // Save activities to event table
                        await saveActivitiesToEventTable(tableName, reg.user_email, activities, startDate, endDate);
                        syncedCount++;
                    } else {
                        syncedCount++; // Count as synced even if no activities
                    }
                } catch (userError) {
                    console.error(`Error syncing user ${reg.user_email}:`, userError);
                    errorCount++;
                }
            }

            showToast(`Sync complete! Synced: ${syncedCount}, No Strava: ${noStravaCount}, Errors: ${errorCount}`, 'success');
            loadEvents(); // Refresh the view
        } catch (error) {
            console.error('Error in force sync:', error);
            showToast('Error: ' + error.message, 'error');
        }
    };

    // Helper: Refresh Strava Token
    async function refreshStravaToken(userEmail, refreshToken) {
        try {
            const STRAVA_CLIENT_ID = '140498';
            const STRAVA_CLIENT_SECRET = 'c2a93379b46d5d414865f831c5a4e5d0f4e68e44';

            const response = await fetch('https://www.strava.com/oauth/token', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    client_id: STRAVA_CLIENT_ID,
                    client_secret: STRAVA_CLIENT_SECRET,
                    refresh_token: refreshToken,
                    grant_type: 'refresh_token'
                })
            });

            if (!response.ok) return null;

            const data = await response.json();

            // Update tokens in database
            await supabase
                .from('profiles')
                .update({
                    strava_access_token: data.access_token,
                    strava_refresh_token: data.refresh_token,
                    strava_token_expires_at: data.expires_at
                })
                .eq('email', userEmail);

            return data.access_token;
        } catch (error) {
            console.error('Token refresh error:', error);
            return null;
        }
    }

    // Helper: Get start of day (00:00:00) for a date string
    function getStartOfDay(dateTimeStr) {
        if (!dateTimeStr) return null;
        let date;
        if (dateTimeStr.includes('T')) {
            date = new Date(dateTimeStr);
        } else {
            const p = dateTimeStr.split(/[-/]/);
            date = new Date(p[0], p[1] - 1, p[2], 0, 0, 0, 0);
        }
        date.setHours(0, 0, 0, 0);
        if (isNaN(date.getTime())) {
            console.error('Invalid date:', dateTimeStr);
            return null;
        }
        return date;
    }

    // Helper: Get end of day (23:59:59) for a date string
    function getEndOfDay(dateTimeStr) {
        if (!dateTimeStr) return new Date();
        let date;
        if (dateTimeStr.includes('T')) {
            date = new Date(dateTimeStr);
        } else {
            const p = dateTimeStr.split(/[-/]/);
            date = new Date(p[0], p[1] - 1, p[2], 23, 59, 59, 999);
        }
        date.setHours(23, 59, 59, 999);
        if (isNaN(date.getTime())) {
            console.error('Invalid date:', dateTimeStr);
            return new Date();
        }
        return date;
    }

    // Helper: Fetch Strava Activities
    async function fetchStravaActivities(accessToken, startDate, endDate) {
        try {
            // Strava API 'after' and 'before' use UTC timestamps.
            // We use the precise UTC equivalent of the local event start/end times.
            const startDateObj = getStartOfDay(startDate);
            const endDateObj = getEndOfDay(endDate);

            if (!startDateObj) {
                console.error('Invalid start date:', startDate);
                return [];
            }

            // Convert local midnight to UTC timestamp (seconds)
            const after = Math.floor(startDateObj.getTime() / 1000);
            const before = Math.floor(endDateObj.getTime() / 1000);

            console.log(`Event Local Range: ${startDate} to ${endDate || 'now'}`);
            console.log(`Strava API Range (UTC): ${new Date(after * 1000).toISOString()} to ${new Date(before * 1000).toISOString()}`);

            const response = await fetch(
                `https://www.strava.com/api/v3/athlete/activities?after=${after}&before=${before}&per_page=200`,
                {
                    headers: { 'Authorization': `Bearer ${accessToken}` }
                }
            );

            if (!response.ok) {
                console.error('Strava API error:', response.status);
                return [];
            }

            const activities = await response.json();
            console.log(`Strava returned ${activities.length} activities`);
            return activities;
        } catch (error) {
            console.error('Fetch activities error:', error);
            return [];
        }
    }

    // Helper: Save Activities to Event Table
    async function saveActivitiesToEventTable(tableName, userEmail, activities, startDate, endDate) {
        const startTs = getStartOfDay(startDate).getTime();
        const endTs = getEndOfDay(endDate).getTime();

        console.log(`Filtering activities using UTC comparison: ${new Date(startTs).toISOString()} to ${new Date(endTs).toISOString()}`);

        // Filter activities within event UTC range
        const validActivities = activities.filter(act => {
            // Strava 'start_date' is already a UTC string
            const actTs = new Date(act.start_date).getTime();
            const isValid = actTs >= startTs && actTs <= endTs;

            if (!isValid) {
                console.log(`Skipping activity "${act.name}" on ${act.start_date} (UTC) - outside UTC range`);
            }
            return isValid;
        });

        console.log(`${validActivities.length} activities within date range (filtered from ${activities.length})`);


        for (const activity of validActivities) {
            // Use LOCAL date from Strava (not UTC) to avoid timezone issues
            const activityDate = activity.start_date_local
                ? activity.start_date_local.substring(0, 10)
                : new Date(activity.start_date).toISOString().split('T')[0];
            const activityType = mapActivityType(activity.type);

            // Upsert activity (insert or update if exists)
            const { error } = await supabase
                .from(tableName)
                .upsert({
                    user_email: userEmail,
                    strava_id: activity.id,
                    activity_name: activity.name,
                    activity_type: activityType,
                    activity_date: activityDate,
                    distance: activity.distance || 0,
                    elevation: activity.total_elevation_gain || 0,
                    moving_time: activity.moving_time || 0
                }, {
                    onConflict: 'strava_id'
                });

            if (error) {
                console.error('Error saving activity:', error);
            }
        }
    }

    // Helper: Map Strava activity type to our types
    function mapActivityType(stravaType) {
        const typeMap = {
            'Run': 'run',
            'Walk': 'walk',
            'Hike': 'hiking',
            'Ride': 'cycling',
            'VirtualRide': 'cycling',
            'Swim': 'swimming',
            'EBikeRide': 'cycling'
        };
        return typeMap[stravaType] || stravaType.toLowerCase();
    }

    // Confirm Delete Button
    document.getElementById('confirmDeleteBtn').addEventListener('click', () => {
        if (deleteCallback) deleteCallback();
    });

    // Initialize
    const isAdmin = await checkAdmin();
    if (isAdmin) {
        loadEvents();
    }
});
