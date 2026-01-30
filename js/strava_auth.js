document.addEventListener('DOMContentLoaded', async () => {
    const supabase = window.supabaseClient;
    const StravaAPI = window.StravaAPI;
    const connectBtn = document.getElementById('stravaConnectBtn');
    const statusMsg = document.getElementById('statusMsg');

    if (!supabase || !StravaAPI) {
        console.error('Dependencies not loaded correctly.');
        return;
    }

    // 1. Handle "Connect with STRAVA" button click
    if (connectBtn) {
        connectBtn.addEventListener('click', () => {
            const authUrl = StravaAPI.getAuthorizationUrl();
            window.location.href = authUrl;
        });
    }

    // 2. Handle OAuth Callback (checking for 'code' in URL)
    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get('code');
    const error = urlParams.get('error');

    if (error) {
        console.error('Strava Auth Error:', error);
        alert('Authentication failed: ' + error);
        return;
    }

    if (code) {
        console.log('Detected Strava authorization code, exchanging for tokens...');

        if (connectBtn) {
            connectBtn.disabled = true;
            connectBtn.textContent = 'Connecting...';
        }

        try {
            // Get current session
            const { data: { session } } = await supabase.auth.getSession();
            if (!session) {
                alert('You must be logged in to connect Strava.');
                window.location.href = 'login.html';
                return;
            }

            const userEmail = session.user.email;

            // Step 1: Exchange code for tokens
            const tokenData = await StravaAPI.exchangeToken(code);

            // Step 2: Save tokens to database
            await StravaAPI.saveTokensToDatabase(userEmail, tokenData);

            // Show success message
            if (statusMsg) statusMsg.style.display = 'block';
            if (connectBtn) connectBtn.style.display = 'none';

            // Step 3: Trigger initial activity sync
            console.log('Triggering initial activity sync...');
            const profile = {
                email: userEmail,
                strava_access_token: tokenData.access_token,
                strava_refresh_token: tokenData.refresh_token,
                strava_token_expires_at: tokenData.expires_at
            };

            await StravaAPI.syncActivities(userEmail, profile);

            // Success redirect
            setTimeout(() => {
                window.location.href = 'dashboard.html';
            }, 2000);

        } catch (err) {
            console.error('Error in Strava Auth Callback:', err);
            alert('Failed to connect Strava: ' + err.message);
            if (connectBtn) {
                connectBtn.disabled = false;
                connectBtn.textContent = 'Connect with STRAVA';
            }
        }
    }
});
