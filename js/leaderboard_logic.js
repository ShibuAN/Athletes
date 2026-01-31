document.addEventListener('DOMContentLoaded', async () => {
    // Only run on leaderboard page
    if (!window.location.pathname.includes('leaderboard.html')) return;

    const supabase = window.supabaseClient;
    const leaderboardBody = document.getElementById('leaderboardBody');
    const eventNameFilter = document.getElementById('eventNameFilter');
    const activityTypeFilter = document.getElementById('activityTypeFilter');

    // Cache for events
    let eventsCache = {};

    async function initLeaderboard() {
        console.log('Initializing Leaderboard Logic (On-Demand Strava API)...');

        // Fetch Events
        const { data: events, error } = await supabase
            .from('events')
            .select('*')
            .eq('is_active', true)
            .order('start_date', { ascending: false });

        if (error) {
            console.error('Error fetching events:', error);
            leaderboardBody.innerHTML = '<tr><td colspan="3" style="text-align: center; color: #ef4444;">Error loading events.</td></tr>';
            return;
        }

        if (events && events.length > 0) {
            eventNameFilter.innerHTML = events.map(e => {
                eventsCache[e.id] = e;
                return `<option value="${e.id}">${e.name}</option>`;
            }).join('');

            renderLeaderboard();
        } else {
            eventNameFilter.innerHTML = '<option value="">No Active Events</option>';
            leaderboardBody.innerHTML = '<tr><td colspan="3" style="text-align: center;">No active events found.</td></tr>';
        }
    }

    async function renderLeaderboard() {
        const eventId = eventNameFilter.value;
        const activityFilter = activityTypeFilter.value;

        if (!eventId) return;

        leaderboardBody.innerHTML = '<tr><td colspan="3" style="text-align: center; padding: 2rem;"><i class="fa-solid fa-spinner fa-spin"></i> Fetching live data from Strava...</td></tr>';

        try {
            const event = eventsCache[eventId];
            // Extract just the date part (YYYY-MM-DD) and set to start of day / end of day
            const startDateStr = (event.start_date || "").substring(0, 10);
            const endDateStr = event.end_date ? event.end_date.substring(0, 10) : null;

            // Create dates at midnight local time to include full days
            const startDate = new Date(startDateStr + 'T00:00:00');
            let endDate = endDateStr ? new Date(endDateStr + 'T23:59:59') : new Date(new Date().setFullYear(new Date().getFullYear() + 10));

            console.log(`Fetching leaderboard for event: ${event.name} (${startDate.toISOString()} to ${endDate.toISOString()})`);

            // Fetch Paid Registrations
            const { data: registrations, error: regError } = await supabase
                .from('event_registrations')
                .select('user_email')
                .eq('event_id', eventId)
                .eq('payment_status', 'paid');

            if (regError) {
                throw new Error('Registration fetch failed. ' + regError.message);
            }

            if (!registrations || registrations.length === 0) {
                leaderboardBody.innerHTML = '<tr><td colspan="3" style="text-align: center; padding: 2rem;">No paid participants yet.</td></tr>';
                return;
            }

            const userEmails = [...new Set(registrations.map(r => r.user_email))];

            // Fetch Profiles with Strava tokens
            const { data: profiles, error: profileError } = await supabase
                .from('profiles')
                .select('email, first_name, last_name, strava_connected, strava_access_token, strava_refresh_token, strava_token_expires_at')
                .in('email', userEmails);

            if (profileError) {
                console.error('Error fetching profiles:', profileError);
            }

            const profileMap = {};
            const activeUserEmails = [];

            if (profiles) {
                profiles.forEach(p => {
                    profileMap[p.email] = p;
                    if (p.strava_connected && p.strava_access_token) {
                        activeUserEmails.push(p.email);
                    }
                });
            }

            console.log('Total Registered Users:', userEmails.length);
            console.log('Connected Strava Users:', activeUserEmails.length);

            if (activeUserEmails.length === 0) {
                leaderboardBody.innerHTML = '<tr><td colspan="3" style="text-align: center; padding: 2rem;">No participants have connected their Strava account yet.</td></tr>';
                return;
            }

            // Initialize user map
            const userMap = {};
            activeUserEmails.forEach(email => {
                const profile = profileMap[email];
                let displayName = email.split('@')[0];

                if (profile) {
                    displayName = `${profile.first_name || ''} ${profile.last_name || ''}`.trim() || displayName;
                    if (displayName.length > 0) {
                        displayName = displayName.charAt(0).toUpperCase() + displayName.slice(1);
                    }
                }

                userMap[email] = {
                    name: displayName,
                    email: email,
                    totalDays: new Set(),
                    eligibleActivities: 0,
                    totalActivities: 0,
                    eligibleDistance: 0,
                    totalDistance: 0,
                    fetchError: false
                };
            });

            // Fetch activities from Strava API for each user (ON-DEMAND)
            console.log(`Fetching activities from Strava API for ${activeUserEmails.length} users...`);

            // Fetch in parallel (with rate limit consideration)
            const fetchPromises = activeUserEmails.map(async (email) => {
                const profile = profileMap[email];
                try {
                    const activities = await StravaAPI.getActivitiesInRange(email, profile, startDate, endDate);
                    return { email, activities, error: null };
                } catch (err) {
                    console.error(`Failed to fetch for ${email}:`, err.message);
                    return { email, activities: [], error: err.message };
                }
            });

            const results = await Promise.all(fetchPromises);

            // Process activities
            results.forEach(({ email, activities, error }) => {
                const userStats = userMap[email];
                if (!userStats) return;

                if (error) {
                    userStats.fetchError = true;
                    return;
                }

                activities.forEach(act => {
                    const type = act.type ? act.type.toLowerCase() : 'unknown';
                    const dist = act.distance || 0;

                    // Count ALL activities within event dates (no filter)
                    userStats.totalActivities++;
                    userStats.totalDistance += dist;

                    // Eligibility Check for supported activity types
                    // Types are normalized by strava_api.js: Ride->cycling, Hike->hiking, Swim->swimming
                    let isEligible = false;

                    if (type === 'walk' || type === 'run' || type === 'hiking') {
                        if (dist >= 3000) isEligible = true;
                    }
                    else if (type === 'cycling') {
                        if (dist >= 10000) isEligible = true;
                    }
                    else if (type === 'swimming') {
                        if (dist >= 500) isEligible = true;
                    }
                    // Swimming (Strava returns 'Swim' not 'swimming')
                    else if (type === 'swim' || type === 'swimming') {
                        if (dist >= 500) isEligible = true;
                    }

                    // Types are already normalized by strava_api.js (Ride->cycling, Hike->hiking, Swim->swimming)
                    const matchesFilter = (activityFilter === 'all' || type === activityFilter.toLowerCase());

                    // Count eligible activities (filtered by dropdown if selected)
                    if (matchesFilter && isEligible) {
                        // start_date already contains local date from strava_api.js transformation
                        const dateStr = act.start_date || "";
                        const activityDate = dateStr.substring(0, 10); // YYYY-MM-DD
                        if (activityDate) {
                            userStats.totalDays.add(activityDate);
                            console.log(`[${userStats.name}] Eligible: ${act.name} | Type: ${type} | Dist: ${(dist/1000).toFixed(2)}km | Date: ${activityDate}`);
                        }
                        userStats.eligibleActivities++;
                        userStats.eligibleDistance += dist;
                    }
                });
            });

            // Log all unique dates for debugging
            Object.values(userMap).forEach(u => {
                const sortedDates = Array.from(u.totalDays).sort();
                console.log(`[${u.name}] Total unique days: ${u.totalDays.size}`);
                console.log(`[${u.name}] Dates counted:`, sortedDates);
            });

            // Sort (by Days then Eligible Distance)
            const sortedUsers = Object.values(userMap).sort((a, b) => {
                if (b.totalDays.size !== a.totalDays.size) return b.totalDays.size - a.totalDays.size;
                return b.eligibleDistance - a.eligibleDistance;
            });

            // Render
            const currentUserEmail = localStorage.getItem('user');

            if (sortedUsers.length === 0) {
                leaderboardBody.innerHTML = '<tr><td colspan="3" style="text-align: center; padding: 2rem;">No eligible activities found within the event dates.</td></tr>';
                return;
            }

            leaderboardBody.innerHTML = sortedUsers.map((u, index) => {
                const isUser = u.email === currentUserEmail;
                let rankClass = '';
                if (index === 0) rankClass = 'rank-1';
                else if (index === 1) rankClass = 'rank-2';
                else if (index === 2) rankClass = 'rank-3';

                const medal = rankClass ? `<span class="rank-badge ${rankClass}">${index + 1}</span>` : `<span style="display:inline-block; width:30px; text-align:center; font-weight:bold;">${index + 1}.</span>`;

                const errorIndicator = u.fetchError ? ' <i class="fa-solid fa-exclamation-triangle" style="color: #eab308;" title="Could not fetch latest data"></i>' : '';

                return `
                    <tr class="${isUser ? 'current-user' : ''}">
                        <td>
                            <div style="display: flex; align-items: center; gap: 0.75rem;">
                                ${medal}
                                <div>
                                    <div style="font-weight: 600;">${u.name}${errorIndicator}</div>
                                    ${isUser ? '<span style="font-size:0.7rem; color:var(--primary);">YOU</span>' : ''}
                                </div>
                            </div>
                        </td>
                        <td>
                            <span style="font-weight: bold; color: var(--text-main);">${event.name.toLowerCase().includes('move your body') ? '21 Days' : 'N/A'}</span>
                            <div style="font-size: 0.75rem; color: var(--text-muted);">Goal</div>
                        </td>
                        <td>
                            <span style="font-weight: bold; color: ${u.totalDays.size >= 21 ? '#22c55e' : 'var(--primary)'};">${u.totalDays.size} Days</span>
                            <div style="font-size: 0.8rem; color: var(--text-muted);">${(u.eligibleDistance / 1000).toFixed(2)} km</div>
                        </td>
                    </tr>
                `;
            }).join('');

            // Add live data note
            const existingNote = document.getElementById('leaderboardNote');
            if (existingNote) existingNote.remove();

            const note = document.createElement('div');
            note.id = 'leaderboardNote';
            note.style.cssText = 'text-align: center; padding: 1rem; color: var(--text-muted); font-size: 0.8rem;';
            note.innerHTML = `<i class="fa-solid fa-bolt" style="color: var(--primary);"></i> Live data from Strava API • Last updated: ${new Date().toLocaleTimeString()}`;
            leaderboardBody.closest('table').parentNode.appendChild(note);

        } catch (err) {
            console.error('Leaderboard Error Details:', err);
            leaderboardBody.innerHTML = `<tr><td colspan="3" style="text-align: center; color: #ef4444;">Error loading leaderboard: ${err.message}</td></tr>`;
        }
    }

    // Initialize
    initLeaderboard();

    // Listeners
    if (eventNameFilter) eventNameFilter.addEventListener('change', renderLeaderboard);
    if (activityTypeFilter) activityTypeFilter.addEventListener('change', renderLeaderboard);
});
