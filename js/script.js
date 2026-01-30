document.addEventListener('DOMContentLoaded', async () => {
    // Use the globally initialized supabase client
    const supabase = window.supabaseClient;

    if (!supabase) {
        console.error('Supabase client not initialized. Check CDN and js/supabase.js');
        return;
    }

    console.log('Athletes Website Loaded');

    // --- 0. Global Date Input Enhancements (Type & Calendar) ---
    function initializeDateInputs() {
        const dateFields = document.querySelectorAll('input[id*="dob"], input[id*="Date"], input[id*="date"], .input-field[placeholder*="YYYY"]');
        dateFields.forEach(input => {
            const container = input.closest('.input-group');
            if (!container) return;
            const isDateTime = input.id.toLowerCase().includes('time') || input.id === 'startDate' || input.id === 'endDate';

            input.type = 'text';
            input.removeAttribute('onfocus');
            input.removeAttribute('onblur');
            container.querySelectorAll('.native-picker-overlay, .picker-label, .hidden-picker, .trigger-zone').forEach(el => el.remove());

            const picker = document.createElement('input');
            picker.type = isDateTime ? 'datetime-local' : 'date';
            picker.className = 'native-picker-overlay';
            container.appendChild(picker);

            const updateLabel = () => {
                if (input.value.trim() !== '') container.classList.add('has-value');
                else container.classList.remove('has-value');
            };

            picker.addEventListener('change', (e) => {
                const val = e.target.value;
                if (!val) return;
                if (isDateTime) {
                    input.value = val.replace('T', ' ');
                } else {
                    const [y, m, d] = val.split('-');
                    input.value = `${d}-${m}-${y}`;
                }
                updateLabel();
                input.dispatchEvent(new Event('input', { bubbles: true }));
            });

            input.addEventListener('input', updateLabel);
            input.addEventListener('blur', updateLabel);
            input.addEventListener('focus', updateLabel);
            updateLabel();

            const icon = container.querySelector('.date-icon');
            if (icon) {
                icon.style.pointerEvents = 'none';
                icon.style.zIndex = '5';
            }
        });
    }
    initializeDateInputs();

    // --- 1. Consolidated Session & Redirect Logic ---
    async function initSession() {
        const { data: { session } } = await supabase.auth.getSession();
        const currentPage = window.location.pathname.split('/').pop() || 'index.html';
        const isAuthPage = ['login.html', 'signup.html', 'login_v2.html', 'signup_v2.html'].includes(currentPage);
        const protectedPages = ['dashboard.html', 'dashboard_v2.html', 'admin_dashboard.html', 'admin_events.html', 'admin_users.html', 'admin_payments.html', 'activities.html', 'profile.html', 'leaderboard.html', 'register_event.html'];

        if (session) {
            localStorage.setItem('user', session.user.email);

            if (isAuthPage) {
                const { data: profile } = await supabase
                    .from('profiles')
                    .select('role')
                    .eq('email', session.user.email)
                    .single();

                if (profile?.role === 'admin') {
                    window.location.href = 'admin_dashboard.html';
                } else {
                    window.location.href = 'dashboard.html';
                }
                return;
            }
        } else {
            if (protectedPages.includes(currentPage)) {
                window.location.href = 'login.html';
                return;
            }
        }

        updateNavbar(session);
        if (session) fetchDashboardData(session.user.email);
    }

    // --- 2. Dynamic Navbar Logic ---
    function updateNavbar(session) {
        const navLinks = document.querySelector('.nav-links');
        if (!navLinks) return;

        const user = session?.user;
        const currentPage = window.location.pathname.split('/').pop() || 'index.html';
        const isHomePage = currentPage === 'index.html' || currentPage === '';
        const isAdminPage = currentPage.startsWith('admin_');
        const currentHash = window.location.hash;

        let navHtml = `
            <a href="index.html" class="nav-link ${isHomePage && !currentHash ? 'active' : ''}" data-nav="home">Home</a>
            <a href="${isHomePage ? '#membership' : 'index.html#membership'}" class="nav-link ${currentHash === '#membership' ? 'active' : ''}" data-nav="membership">Membership</a>
            <a href="${isHomePage ? '#community' : 'index.html#community'}" class="nav-link ${currentHash === '#community' ? 'active' : ''}" data-nav="community">Community</a>
            <a href="events.html" class="nav-link ${currentPage === 'events.html' ? 'active' : ''}">Events</a>
        `;

        if (user) {
            navHtml += `
                <a href="leaderboard.html" class="nav-link ${currentPage === 'leaderboard.html' ? 'active' : ''}">Leaderboard</a>
                <a href="dashboard.html" class="nav-link ${currentPage === 'dashboard.html' ? 'active' : ''}">Dashboard</a>
                <a href="#" id="logoutBtn" class="nav-link">Logout</a>
            `;
            // Add Admin link if user is admin
            supabase.from('profiles').select('role').eq('email', user.email).single().then(({ data }) => {
                const isAdmin = data?.role === 'admin';
                if (isAdmin) {
                    const logoutBtn = document.getElementById('logoutBtn');
                    if (logoutBtn && !document.querySelector('a[href="admin_dashboard.html"]')) {
                        const adminLink = document.createElement('a');
                        adminLink.href = 'admin_dashboard.html';
                        adminLink.innerHTML = 'Admin Panel';
                        adminLink.style.color = 'var(--secondary)';
                        adminLink.style.fontWeight = '700';
                        adminLink.style.marginRight = '1rem';
                        logoutBtn.parentNode.insertBefore(adminLink, logoutBtn);
                    }
                }
            });
        } else {
            navHtml += `
                <a href="login.html" class="nav-link ${currentPage === 'login.html' ? 'active' : ''}">Login</a>
                <a href="signup.html" class="btn btn-primary btn-sm">Sign Up</a>
            `;
        }

        navLinks.innerHTML = navHtml;

        const logoutBtn = document.getElementById('logoutBtn');
        if (logoutBtn) logoutBtn.addEventListener('click', performLogout);

        // Add Hash Highlight Logic for Home Page
        if (isHomePage) {
            setupActiveLinkHighlighting();
        }
    }

    function setupActiveLinkHighlighting() {
        const sections = ['membership', 'community'];
        const observerOptions = {
            root: null,
            rootMargin: '-10% 0px -40% 0px', // Trigger when section is in top half of viewport
            threshold: 0
        };

        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    updateActiveLink(entry.target.id);
                }
            });
        }, observerOptions);

        sections.forEach(id => {
            const el = document.getElementById(id);
            if (el) observer.observe(el);
        });

        // Special case for top of page (Home)
        window.addEventListener('scroll', () => {
            if (window.scrollY < 300) {
                const membershipEl = document.getElementById('membership');
                const rect = membershipEl?.getBoundingClientRect();
                // If membership haven't reached top yet, keep Home active
                if (!rect || rect.top > 200) {
                    updateActiveLink('home');
                }
            }
        });

        window.addEventListener('hashchange', () => {
            const hash = window.location.hash.replace('#', '');
            if (hash) updateActiveLink(hash);
        });
    }

    function updateActiveLink(activeId) {
        document.querySelectorAll('.nav-link').forEach(link => {
            const linkNav = link.getAttribute('data-nav');
            if (linkNav) {
                if (linkNav === activeId) {
                    link.classList.add('active');
                } else {
                    link.classList.remove('active');
                }
            }
        });
    }

    // --- 3. Functional Logic ---
    async function performLogout(e) {
        if (e) e.preventDefault();
        await supabase.auth.signOut();
        localStorage.removeItem('user');
        window.location.href = 'index.html';
    }

    // Dashboard Data Fetching
    async function fetchDashboardData(email) {
        const { data: profile, error: profError } = await supabase
            .from('profiles')
            .select('*')
            .eq('email', email)
            .single();

        if (profile) {
            // Update Welcome Name
            const userNameEl = document.getElementById('userName');
            if (userNameEl) userNameEl.textContent = profile.first_name || 'Athlete';

            // Handle Smart Strava Toggle Button
            const stravaStatusEl = document.getElementById('stravaStatus');
            const toggleBtn = document.getElementById('stravaToggleButton');

            if (stravaStatusEl) {
                if (profile.strava_connected) {
                    stravaStatusEl.innerHTML = '<span style="color: #22c55e;"><i class="fa-solid fa-circle-check"></i> Connected</span>';

                    // AUTO-SYNC Logic
                    const lastSync = localStorage.getItem('last_strava_sync');
                    const now = Date.now();
                    const fiveMinutes = 5 * 60 * 1000;

                    if (!lastSync || (now - lastSync > fiveMinutes)) {
                        console.log('Auto-syncing Strava data...');
                        if (toggleBtn) {
                            toggleBtn.disabled = true;
                            toggleBtn.textContent = 'Syncing...';
                        }

                        StravaAPI.syncActivities(email, profile).then(() => {
                            localStorage.setItem('last_strava_sync', now);
                            console.log('Auto-sync complete');
                            // Recalculate dashboard stats without full reload if possible, 
                            // but for simplicity and to ensure all components update:
                            location.reload();
                        }).catch(err => {
                            console.error('Sync failed:', err);
                            if (toggleBtn) {
                                toggleBtn.disabled = false;
                                toggleBtn.textContent = 'Sync Strava';
                            }
                        });
                    }

                    if (toggleBtn) {
                        toggleBtn.innerHTML = 'Unsync Strava';
                        toggleBtn.className = 'btn btn-primary';
                        toggleBtn.style.display = 'inline-flex';

                        toggleBtn.onclick = async () => {
                            if (confirm('Are you sure you want to unsync Strava? This will hide your activities from the dashboard.')) {
                                toggleBtn.disabled = true;
                                toggleBtn.innerHTML = '<i class="fa-solid fa-sync fa-spin"></i> Unsyncing...';
                                try {
                                    await supabase.from('profiles').update({ strava_connected: false, strava_access_token: null }).eq('email', email);
                                    localStorage.removeItem('last_strava_sync');
                                    location.reload();
                                } catch (err) {
                                    alert('Unsync failed: ' + err.message);
                                    toggleBtn.disabled = false;
                                    toggleBtn.innerHTML = 'Unsync Strava';
                                }
                            }
                        };
                    }
                } else {
                    stravaStatusEl.innerHTML = '<span style="color: var(--text-muted);">Not Connected</span>';
                    if (toggleBtn) {
                        toggleBtn.textContent = 'Connect Strava';
                        toggleBtn.className = 'btn btn-primary';
                        toggleBtn.onclick = () => window.location.href = 'strava_auth.html';
                    }

                    // CLEAR UI if not connected (Keep data in DB but hide from view)
                    const totalActivitiesEl = document.getElementById('totalActivities');
                    if (totalActivitiesEl) totalActivitiesEl.textContent = '0';
                    const activityListEl = document.getElementById('activityList');
                    if (activityListEl) activityListEl.innerHTML = '<div style="text-align: center; padding: 3rem; color: var(--text-muted);">Sync Strava to see your performances.</div>';
                    return; // Stop here if not connected - ensures data stays hidden
                }
            }
        }

        // 1. Enrolled Events
        const eventListEl = document.getElementById('enrolledEventsList');
        if (eventListEl) {
            try {
                const { data, error } = await supabase
                    .from('event_registrations')
                    .select('*, events(name, price, start_date)')
                    .eq('user_email', email)
                    .order('registration_date', { ascending: false });

                if (error) throw error;

                if (data && data.length > 0) {
                    eventListEl.innerHTML = data.map(reg => {
                        const isPaid = reg.payment_status === 'paid';
                        return `
                        <div class="activity-item" style="border-left: 4px solid ${isPaid ? '#22c55e' : '#eab308'};">
                            <div>
                                <h4 style="color: var(--primary);">${reg.events?.name || 'Unknown Event'}</h4>
                                <span style="font-size: 0.8rem; color: var(--text-muted);">
                                    Registered: ${new Date(reg.registration_date).toLocaleDateString()}
                                </span>
                            </div>
                            <div style="text-align: right;">
                                <div style="font-weight: 800; color: ${isPaid ? '#22c55e' : '#eab308'};">
                                    ${isPaid ? 'PAID & JOINED' : 'PAYMENT PENDING'}
                                </div>
                                <div style="font-size: 0.8rem; color: var(--text-muted);">₹${reg.events?.price || '0.00'}</div>
                            </div>
                        </div>
                    `}).join('');
                } else {
                    eventListEl.innerHTML = '<div style="text-align: center; padding: 2rem; color: var(--text-muted);">You haven\'t joined any events yet.</div>';
                }
            } catch (err) {
                console.error('Error fetching dashboard events:', err);
            }
        }

        // 2. Recent Activities (Limit to 5)
        const listEl = document.getElementById('activityList');
        const countEl = document.getElementById('totalActivities');
        if (listEl) {
            try {
                const { data: acts } = await supabase
                    .from('strava_activities')
                    .select('*')
                    .eq('user_email', email)
                    .order('start_date', { ascending: false })
                    .limit(5);

                // Calculate Start of Month
                const now = new Date();
                const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

                const { count: totalCount } = await supabase
                    .from('strava_activities')
                    .select('*', { count: 'exact', head: true })
                    .eq('user_email', email)
                    .gte('start_date', startOfMonth);

                if (countEl) countEl.textContent = totalCount || 0;

                if (acts && acts.length > 0) {
                    listEl.innerHTML = acts.map(act => `
                        <div class="activity-item">
                            <div>
                                <h4 style="color: var(--primary);">${act.name || act.type}</h4>
                                <span style="font-size: 0.9rem; color: var(--text-muted);">${act.type} • ${new Date(act.start_date).toLocaleDateString()}</span>
                            </div>
                            <div style="text-align: right;">
                                <div style="font-weight: 600;">${(act.distance / 1000).toFixed(2)} km</div>
                                <span style="font-size: 0.8rem; color: var(--text-muted);">${Math.floor(act.moving_time / 60)} min</span>
                            </div>
                        </div>
                    `).join('');
                } else {
                    listEl.innerHTML = '<div style="text-align: center; padding: 3rem; color: var(--text-muted);">No synced activities found.</div>';
                }
            } catch (err) {
                console.error('Error loading dashboard activities:', err);
            }
        }
    }

    // Profile Page Logic
    if (window.location.pathname.includes('profile.html')) {
        const profileForm = document.getElementById('profileForm');
        if (profileForm) {
            const userEmail = localStorage.getItem('user');
            const { data: profile } = await supabase.from('profiles').select('*').eq('email', userEmail).single();

            if (profile) {
                document.getElementById('firstName').value = profile.first_name || '';
                document.getElementById('lastName').value = profile.last_name || '';
                document.getElementById('phone').value = profile.phone || '';
                document.getElementById('address').value = profile.address || '';
                document.getElementById('city').value = profile.city || '';

                // Make read-only for non-admins
                if (profile.role !== 'admin') {
                    const inputs = profileForm.querySelectorAll('input');
                    inputs.forEach(input => input.readOnly = true);
                    const submitBtn = profileForm.querySelector('button[type="submit"]');
                    if (submitBtn) {
                        submitBtn.textContent = 'Read Only (Contact Admin to Edit)';
                        submitBtn.disabled = true;
                        submitBtn.style.opacity = '0.5';
                        submitBtn.style.cursor = 'not-allowed';
                    }
                }
            }

            profileForm.onsubmit = async (e) => {
                e.preventDefault();
                // Only admins reach here if the button isn't disabled, but just as a safeguard:
                const { data: check } = await supabase.from('profiles').select('role').eq('email', userEmail).single();
                if (check?.role !== 'admin') {
                    alert('Only administrators can modify profile data.');
                    return;
                }

                const updates = {
                    first_name: document.getElementById('firstName').value,
                    last_name: document.getElementById('lastName').value,
                    phone: document.getElementById('phone').value,
                    address: document.getElementById('address').value,
                    city: document.getElementById('city').value,
                };

                const { error } = await supabase.from('profiles').update(updates).eq('email', userEmail);
                if (error) alert('Error updating profile: ' + error.message);
                else alert('Profile updated successfully!');
            };
        }
    }

    // --- 4. Auth Form Handlers ---
    const loginForm = document.getElementById('loginForm');
    if (loginForm) {
        loginForm.onsubmit = async (e) => {
            e.preventDefault();
            const email = document.getElementById('email').value;
            const password = document.getElementById('password').value;
            const submitBtn = loginForm.querySelector('button[type="submit"]');

            try {
                submitBtn.disabled = true;
                submitBtn.textContent = 'Logging in...';

                const { data, error } = await supabase.auth.signInWithPassword({
                    email,
                    password
                });

                if (error) throw error;

                // Success redirect happens in initSession on reload, but we can force it here
                const { data: profile } = await supabase
                    .from('profiles')
                    .select('role')
                    .eq('email', email)
                    .single();

                if (profile?.role === 'admin') {
                    window.location.href = 'admin_dashboard.html';
                } else {
                    window.location.href = 'dashboard.html';
                }

            } catch (err) {
                console.error('Login error:', err);
                alert('Login failed: ' + (err.message || 'Unknown error'));
                submitBtn.disabled = false;
                submitBtn.textContent = 'Log In';
            }
        };
    }

    const signupForm = document.getElementById('signupForm');
    if (signupForm) {
        signupForm.onsubmit = async (e) => {
            e.preventDefault();
            const submitBtn = document.getElementById('submitBtn');
            const processingDiv = document.getElementById('signupProcessing');

            try {
                const email = document.getElementById('email').value;
                const password = document.getElementById('password').value;

                submitBtn.disabled = true;
                submitBtn.textContent = 'Processing...';

                // Basic Validation
                const phone = document.getElementById('phone').value;
                const hasSeparateWhatsapp = document.getElementById('hasSeparateWhatsapp').checked;
                const whatsapp = hasSeparateWhatsapp ? document.getElementById('whatsappNumber').value : phone;

                if (!/^\d{10,}$/.test(phone)) {
                    throw new Error('Please enter a valid phone number (at least 10 digits).');
                }
                if (hasSeparateWhatsapp && !/^\d{10,}$/.test(whatsapp)) {
                    throw new Error('Please enter a valid WhatsApp number (at least 10 digits).');
                }

                // 1. Auth Sign Up
                const { data: authData, error: authError } = await supabase.auth.signUp({
                    email,
                    password
                });

                if (authError) throw authError;

                // 2. Create Profile
                const profileData = {
                    email: email,
                    first_name: document.getElementById('firstName').value,
                    last_name: document.getElementById('lastName').value,
                    dob: document.getElementById('dob').value,
                    gender: document.getElementById('gender').value,
                    blood_group: document.getElementById('bloodGroup').value,
                    medical_issues: document.getElementById('medicalIssues').value,
                    address: document.getElementById('address').value,
                    city: document.getElementById('city').value,
                    state: document.getElementById('state').value,
                    pincode: document.getElementById('pincode').value,
                    phone: document.getElementById('phone').value,
                    whatsapp_number: document.getElementById('hasSeparateWhatsapp').checked ?
                        document.getElementById('whatsappNumber').value :
                        document.getElementById('phone').value,
                    strava_connected: false
                };

                const { error: profError } = await supabase.from('profiles').insert([profileData]);
                if (profError) throw profError;

                // 3. UI Transition
                if (signupForm) signupForm.style.display = 'none';
                if (processingDiv) processingDiv.style.display = 'block';

                setTimeout(() => {
                    window.location.href = 'strava_auth.html';
                }, 2000);

            } catch (err) {
                console.error('Signup error:', err);
                alert('Signup failed: ' + (err.message || 'Unknown error'));
                submitBtn.disabled = false;
                submitBtn.textContent = 'Complete Registration';
            }
        };
    }

    await initSession();

    // ==========================================
    // ADMIN: Create User Logic
    // ==========================================
    const createUserBtn = document.getElementById('createUserBtn');
    const createUserModal = document.getElementById('createUserModal');
    const createUserForm = document.getElementById('createUserForm');

    if (createUserBtn && createUserModal) {
        createUserBtn.addEventListener('click', () => {
            createUserModal.style.display = 'block';
            setTimeout(() => createUserModal.classList.add('show'), 10);
        });

        window.closeCreateUserModal = () => {
            createUserModal.classList.remove('show');
            setTimeout(() => createUserModal.style.display = 'none', 300);
            if (createUserForm) createUserForm.reset();
        };

        if (createUserForm) {
            createUserForm.addEventListener('submit', async (e) => {
                e.preventDefault();
                const btn = createUserForm.querySelector('button[type="submit"]');
                const originalText = btn.innerHTML;
                btn.disabled = true;
                btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Creating...';

                try {
                    const email = document.getElementById('newEmail').value;
                    const password = document.getElementById('newPassword').value;
                    const role = document.getElementById('newRole').value;
                    const firstName = document.getElementById('newFirstName').value;
                    const lastName = document.getElementById('newLastName').value;
                    const phone = document.getElementById('newPhone').value;

                    // 1. Get credentials from existing client
                    const sUrl = window.supabaseClient.supabaseUrl;
                    const sKey = window.supabaseClient.supabaseKey;

                    // 2. Create Secondary Client (No Session Persistence)
                    // @ts-ignore
                    const tempClient = window.supabase.createClient(sUrl, sKey, {
                        auth: {
                            persistSession: false,
                            autoRefreshToken: false,
                            detectSessionInUrl: false
                        }
                    });

                    // 3. Sign Up (Create Auth User)
                    const { data: authData, error: authError } = await tempClient.auth.signUp({
                        email,
                        password
                    });

                    if (authError) throw authError;
                    if (!authData.user) throw new Error('User creation failed (no user returned)');

                    console.log('User created in Auth:', authData.user.id);

                    // 4. Create/Update Profile (Using Admin Session)
                    // Try Insert first
                    const { error: profileError } = await supabase
                        .from('profiles')
                        .insert([{
                            id: authData.user.id,
                            email: email,
                            role: role,
                            first_name: firstName,
                            last_name: lastName,
                            phone: phone,
                            strava_connected: false,
                            created_at: new Date()
                        }]);

                    if (profileError) {
                        console.warn('Insert failed, trying update (possible trigger conflict)...', profileError.message);
                        // Fallback: Update if row exists (e.g. created by trigger)
                        const { error: updateError } = await supabase
                            .from('profiles')
                            .update({
                                role: role,
                                first_name: firstName,
                                last_name: lastName,
                                phone: phone
                            })
                            .eq('id', authData.user.id);

                        if (updateError) throw updateError;
                    }

                    alert('User created successfully!');
                    closeCreateUserModal();

                    // Refresh list
                    if (typeof fetchAllUsers === 'function') {
                        fetchAllUsers();
                    } else {
                        location.reload();
                    }

                } catch (err) {
                    console.error('Create User Error:', err);
                    alert('Error: ' + err.message);
                } finally {
                    btn.disabled = false;
                    btn.innerHTML = originalText;
                }
            });
        }
    }
});
