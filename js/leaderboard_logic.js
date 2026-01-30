document.addEventListener('DOMContentLoaded', async () => {
    // Only run on leaderboard page
    if (!window.location.pathname.includes('leaderboard.html')) return;

    const supabase = window.supabaseClient;
    const leaderboardBody = document.getElementById('leaderboardBody');
    const eventNameFilter = document.getElementById('eventNameFilter');
    const activityTypeFilter = document.getElementById('activityTypeFilter');

    // Cache for events to get dates
    let eventsCache = {};

    async function initLeaderboard() {
        console.log('Initializing Leaderboard Logic...');

        // 1. Fetch Events
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

            // Trigger load for first event
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

        leaderboardBody.innerHTML = '<tr><td colspan="3" style="text-align: center; padding: 2rem;">Loading live data...</td></tr>';

        try {
            const event = eventsCache[eventId];
            // Start of event day
            // Use consistent date-only comparison or respect time if provided
            const startDate = (event.start_date || "").includes('T') ? event.start_date : (event.start_date || "") + 'T00:00:00';
            let endDate = event.end_date ? (event.end_date.includes('T') ? event.end_date : event.end_date + 'T23:59:59') : new Date(new Date().setFullYear(new Date().getFullYear() + 10)).toISOString();

            console.log(`Fetching leaderboard for event: ${event.name} (${startDate} to ${endDate})`);

            // 2. Fetch Paid Registrations
            // We fetch registrations first, then manually fetch profiles to avoid "relationship not found" errors
            const { data: registrations, error: regError } = await supabase
                .from('event_registrations')
                .select('user_email')
                .eq('event_id', eventId)
                .eq('payment_status', 'paid');

            if (regError) {
                console.error('Error fetching registrations:', regError);
                throw new Error('Registration fetch failed. ' + regError.message);
            }

            if (!registrations || registrations.length === 0) {
                leaderboardBody.innerHTML = '<tr><td colspan="3" style="text-align: center; padding: 2rem;">No paid participants yet.</td></tr>';
                return;
            }

            // Extract unique emails
            const userEmails = [...new Set(registrations.map(r => r.user_email))];

            // 2b. Fetch Profiles manually
            const { data: profiles, error: profileError } = await supabase
                .from('profiles')
                .select('email, first_name, last_name, strava_connected')
                .in('email', userEmails);

            if (profileError) {
                console.error('Error fetching profiles:', profileError);
                // We continue without profiles, but we can't filter strava_connected easily without them
            }

            const profileMap = {};
            const activeUserEmails = []; // Only those connected to Strava

            if (profiles) {
                profiles.forEach(p => {
                    profileMap[p.email] = p;
                    if (p.strava_connected) {
                        activeUserEmails.push(p.email);
                    }
                });
            }

            console.log('Total Registered Users:', userEmails.length);
            console.log('Connected Strava Users:', activeUserEmails.length);

            if (activeUserEmails.length === 0) {
                leaderboardBody.innerHTML = '<tr><td colspan="3" style="text-align: center; padding: 2rem;">No participants have synced their Strava account yet.</td></tr>';
                return;
            }

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
                    totalActivities: 0,
                    totalDistance: 0
                };
            });

            // 3. Fetch Activities for these users within range
            console.log(`Fetching DB activities between ${startDate} and ${endDate} for ${activeUserEmails.length} users`);
            const { data: activities, error: actError } = await supabase
                .from('strava_activities')
                .select('*')
                .in('user_email', activeUserEmails)
                .gte('start_date', startDate)
                .lte('start_date', endDate);

            if (actError) throw actError;

            console.log(`Found ${activities ? activities.length : 0} activities in DB for this range.`);

            // 4. Aggregate Data
            console.log(`Processing ${activities.length} activities for eligibility...`);

            activities.forEach(act => {
                const userStats = userMap[act.user_email];
                if (!userStats) return;

                // --- Eligibility Check for "Total Days Active" ---
                let isEligible = false;
                const type = act.type ? act.type.toLowerCase() : 'unknown';
                const dist = act.distance || 0;

                if (type === 'walk' || type === 'run' || type === 'hiking') {
                    if (dist >= 3000) isEligible = true;
                } else if (type === 'cycling') {
                    if (dist >= 10000) isEligible = true;
                } else if (type === 'swimming') {
                    if (dist >= 500) isEligible = true;
                }

                const matchesFilter = (activityFilter === 'all' || type === activityFilter.toLowerCase());

                if (matchesFilter) {
                    if (isEligible) {
                        // More robust date extraction (handles both ISO 'T' and space separators)
                        const activityDate = (act.start_date || "").substring(0, 10);
                        if (activityDate) {
                            userStats.totalDays.add(activityDate);
                        }
                    }
                    userStats.totalActivities++;
                    userStats.totalDistance += dist;
                } else {
                    console.log(`Activity ${act.strava_id} skipped: type ${type} does not match filter ${activityFilter}`);
                }
            });

            console.log('Aggregation Results (User Map):', userMap);

            // 5. Sort (by Days then Distance)
            const sortedUsers = Object.values(userMap).sort((a, b) => {
                if (b.totalDays.size !== a.totalDays.size) return b.totalDays.size - a.totalDays.size;
                return b.totalDistance - a.totalDistance;
            });

            // 6. Render
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

                return `
                    <tr class="${isUser ? 'current-user' : ''}">
                        <td>
                            <div style="display: flex; align-items: center; gap: 0.75rem;">
                                ${medal}
                                <div>
                                    <div style="font-weight: 600;">${u.name}</div>
                                    ${isUser ? '<span style="font-size:0.7rem; color:var(--primary);">YOU</span>' : ''}
                                </div>
                            </div>
                        </td>
                        <td>
                            <span style="font-weight: bold; color: var(--primary);">${u.totalDays.size} Days</span>
                            ${event.name.toLowerCase().includes('move your body') ? '<div style="font-size: 0.75rem; color: var(--text-muted);">Goal: 21 Days</div>' : ''}
                        </td>
                        <td>
                            <div>${u.totalActivities} Acts</div>
                            <div style="font-size: 0.8rem; color: var(--text-muted);">${(u.totalDistance / 1000).toFixed(2)} km</div>
                        </td>
                    </tr>
                `;
            }).join('');

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
