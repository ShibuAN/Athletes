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
        console.log('Initializing Leaderboard Logic (Event Table Based)...');

        // Fetch Events that have started (activity tables should exist)
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

        leaderboardBody.innerHTML = '<tr><td colspan="3" style="text-align: center; padding: 2rem;"><i class="fa-solid fa-spinner fa-spin"></i> Loading leaderboard...</td></tr>';

        try {
            const event = eventsCache[eventId];

            // Check if event has activity table
            if (!event.activity_table_name || !event.activity_table_created) {
                // Try to create table if event has started
                const eventStartDate = new Date(event.start_date);
                if (eventStartDate <= new Date()) {
                    console.log('Event started but no table, attempting to create...');
                    try {
                        const { data: tableName, error: createError } = await supabase.rpc('create_event_activity_table', {
                            event_id: eventId
                        });
                        if (!createError && tableName) {
                            event.activity_table_name = tableName;
                            event.activity_table_created = true;
                            eventsCache[eventId] = event;
                        }
                    } catch (err) {
                        console.error('Failed to create event table:', err);
                    }
                }

                if (!event.activity_table_name) {
                    leaderboardBody.innerHTML = '<tr><td colspan="3" style="text-align: center; padding: 2rem;">Event has not started yet. Leaderboard will be available once the event begins.</td></tr>';
                    return;
                }
            }

            console.log(`Loading leaderboard from table: ${event.activity_table_name}`);

            // Fetch Paid Registrations to get list of participants
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

            // Fetch Profiles for display names using secure RPC function
            const { data: profiles, error: profileError } = await supabase
                .rpc('get_leaderboard_profiles', {
                    user_emails: userEmails
                });

            if (profileError) {
                console.error('Error fetching profiles:', profileError);
            }

            const profileMap = {};
            if (profiles) {
                profiles.forEach(p => {
                    profileMap[p.email] = p;
                });
            }

            // Fetch ALL activities from event table
            const { data: activities, error: actError } = await supabase
                .from(event.activity_table_name)
                .select('*');

            if (actError) {
                console.error('Error fetching activities:', actError);
                throw new Error('Failed to load activities: ' + actError.message);
            }

            console.log(`Loaded ${activities ? activities.length : 0} activities from event table`);

            // Initialize user map for all registered users
            const userMap = {};
            userEmails.forEach(email => {
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
                    stravaConnected: profile ? profile.strava_connected : false
                };
            });

            // Process activities from event table
            if (activities && activities.length > 0) {
                activities.forEach(act => {
                    const userStats = userMap[act.user_email];
                    if (!userStats) return; // Activity from unregistered user

                    const type = act.activity_type ? act.activity_type.toLowerCase() : 'unknown';
                    const dist = parseFloat(act.distance) || 0;

                    // Count ALL activities
                    userStats.totalActivities++;
                    userStats.totalDistance += dist;

                    // Eligibility Check
                    let isEligible = false;

                    if (type === 'walk' || type === 'run' || type === 'hiking') {
                        if (dist >= 3000) isEligible = true;
                    }
                    else if (type === 'cycling') {
                        if (dist >= 10000) isEligible = true;
                    }
                    else if (type === 'swimming' || type === 'swim') {
                        if (dist >= 500) isEligible = true;
                    }

                    // Activity type filter
                    const matchesFilter = (activityFilter === 'all' || type === activityFilter.toLowerCase());

                    // Count eligible activities
                    if (matchesFilter && isEligible) {
                        const activityDate = act.activity_date;
                        if (activityDate) {
                            userStats.totalDays.add(activityDate);
                            console.log(`[${userStats.name}] Eligible: ${act.activity_name} | Type: ${type} | Dist: ${(dist / 1000).toFixed(2)}km | Date: ${activityDate}`);
                        }
                        userStats.eligibleActivities++;
                        userStats.eligibleDistance += dist;
                    }
                });
            }

            // Log stats for debugging
            Object.values(userMap).forEach(u => {
                const sortedDates = Array.from(u.totalDays).sort();
                console.log(`[${u.name}] Total unique days: ${u.totalDays.size}`, sortedDates);
            });

            // Sort (by Days then Eligible Distance)
            const sortedUsers = Object.values(userMap).sort((a, b) => {
                if (b.totalDays.size !== a.totalDays.size) return b.totalDays.size - a.totalDays.size;
                return b.eligibleDistance - a.eligibleDistance;
            });

            // Render
            const currentUserEmail = localStorage.getItem('user');

            if (sortedUsers.length === 0) {
                leaderboardBody.innerHTML = '<tr><td colspan="3" style="text-align: center; padding: 2rem;">No participants found.</td></tr>';
                return;
            }

            leaderboardBody.innerHTML = sortedUsers.map((u, index) => {
                const isUser = u.email === currentUserEmail;
                let rankClass = '';
                if (index === 0) rankClass = 'rank-1';
                else if (index === 1) rankClass = 'rank-2';
                else if (index === 2) rankClass = 'rank-3';

                const medal = rankClass ? `<span class="rank-badge ${rankClass}">${index + 1}</span>` : `<span style="display:inline-block; width:30px; text-align:center; font-weight:bold;">${index + 1}.</span>`;

                // Show indicator if user hasn't connected Strava or synced
                const notSyncedIndicator = (!u.stravaConnected || u.totalActivities === 0)
                    ? ' <i class="fa-solid fa-clock" style="color: #6b7280;" title="Waiting for activity sync"></i>'
                    : '';

                return `
                    <tr class="${isUser ? 'current-user' : ''}">
                        <td>
                            <div style="display: flex; align-items: center; gap: 0.75rem;">
                                ${medal}
                                <div>
                                    <div style="font-weight: 600;">${u.name}${notSyncedIndicator}</div>
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

            // Add note
            const existingNote = document.getElementById('leaderboardNote');
            if (existingNote) existingNote.remove();

            const note = document.createElement('div');
            note.id = 'leaderboardNote';
            note.style.cssText = 'text-align: center; padding: 1rem; color: var(--text-muted); font-size: 0.8rem;';
            note.innerHTML = `<i class="fa-solid fa-database" style="color: var(--primary);"></i> Data synced from participants' Strava accounts • Last loaded: ${new Date().toLocaleTimeString()}`;
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
