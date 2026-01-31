# Strava Integration Setup Guide

## Overview
This guide will help you set up the Strava OAuth integration for your Athletes website. Follow these steps carefully to enable Strava activity syncing.

---

## Step 1: Create Strava API Application

1. **Go to Strava API Settings**: https://www.strava.com/settings/api
2. **Click "Create App"** or use an existing app
3. **Fill in the application details**:
   - **Application Name**: Athletes Website (or your preferred name)
   - **Category**: Choose appropriate category (e.g., "Training")
   - **Website**: Your website URL (e.g., http://localhost or your domain)
   - **Authorization Callback Domain**: 
     - For local testing: `localhost`
     - For production: Your actual domain (e.g., `athletes.com`)
4. **Click "Create"**
5. **Copy your credentials**:
   - **Client ID** (a number like `123456`)
   - **Client Secret** (a string like `abc123def456...`)

---

## Step 2: Configure Strava Credentials

1. **Open the file**: `js/strava_config.js`
2. **Replace the placeholder values** with your actual credentials:

```javascript
const STRAVA_CONFIG = {
    CLIENT_ID: '123456',  // Replace with your Client ID
    CLIENT_SECRET: 'your_client_secret_here',  // Replace with your Client Secret
    // ... rest of the config
};
```

> **⚠️ IMPORTANT**: Never commit your `Client Secret` to public repositories!

---

## Step 3: Set Up Supabase Database

1. **Log in to your Supabase dashboard**: https://supabase.com
2. **Navigate to SQL Editor**
3. **Open the file**: `database_setup.sql` (in your project folder)
4. **Copy all the SQL commands** from the file
5. **Paste and run** the SQL commands in the Supabase SQL Editor
6. **Verify success**: You should see confirmation messages

The SQL script will:
- Add Strava token columns to the `profiles` table
- Create a new `strava_activities` table
- Set up proper indexes and security policies

---

## Step 4: Test the Integration

### 4.1 Start Local Server

You need to run a local web server (not just open HTML files directly):

**Option A: Using Python**
```bash
# If you have Python 3
cd "c:\Users\Win 11\Downloads\shibu\ataltes_website"
python -m http.server 8000
```

**Option B: Using Node.js**
```bash
# If you have Node.js
cd "c:\Users\Win 11\Downloads\shibu\ataltes_website"
npx http-server -p 8000
```

**Option C: Using VS Code**
- Install "Live Server" extension
- Right-click on `index.html` → "Open with Live Server"

### 4.2 Test OAuth Flow

1. **Open your browser** and go to: `http://localhost:8000`
2. **Sign up or log in** to your Athletes account
3. **Navigate to Strava Auth page**: Click the Strava connection prompt or go to `strava_auth.html`
4. **Click "Connect with STRAVA"**
5. **You should be redirected to Strava's authorization page**
6. **Log in with your Strava account** (if not already logged in)
7. **Click "Authorize"** to grant permissions
8. **You'll be redirected back** to your website
9. **Activities should sync automatically**
10. **Check the dashboard** - you should see your Strava activities!

### 4.3 Verify Data in Supabase

1. Go to your **Supabase dashboard**
2. Navigate to **Table Editor**
3. Open the `profiles` table:
   - Find your user record
   - Check that `strava_connected` = `true`
   - Check that `strava_access_token` has a value
4. Open the `strava_activities` table:
   - You should see your synced activities
   - Each activity should have: name, type, distance, duration, etc.

---

## Step 5: Using the Dashboard

Once connected, you can:

- **View Activities**: See all your synced Strava activities on the dashboard
- **Sync Manually**: Click the "Sync Strava" button to fetch new activities
- **Auto-refresh**: Activities are automatically loaded when you open the dashboard
- **Activity Details**: Each activity shows:
  - Activity name
  - Type (Run, Ride, Swim, etc.)
  - Distance (in kilometers)
  - Duration (in minutes)
  - Date

---

## Troubleshooting

### Issue: "Client ID or Client Secret is incorrect"
- Double-check your credentials in `js/strava_config.js`
- Make sure you copied the entire secret (no extra spaces)

### Issue: "Redirect URI mismatch"
- In Strava API settings, make sure the callback domain matches your current domain
- For localhost: use `localhost` (not `127.0.0.1`)
- For production: use your actual domain without `http://` or `https://`

### Issue: "No activities showing"
- Check browser console for errors (F12)
- Verify database was set up correctly
- Make sure you have activities on your Strava account
- Try clicking "Sync Strava" button manually

### Issue: "Token expired" errors
- The integration automatically refreshes tokens
- If it fails, try disconnecting and reconnecting Strava

### Issue: Database errors
- Make sure you ran ALL the SQL commands from `database_setup.sql`
- Check Supabase logs for specific error messages
- Verify RLS policies are set up correctly

---

## Security Best Practices

1. **Never expose your Client Secret**:
   - Don't commit it to public repositories
   - Use environment variables in production

2. **Use HTTPS in production**:
   - Strava requires HTTPS for production apps
   - Get an SSL certificate for your domain

3. **Protect your tokens**:
   - Tokens are stored securely in Supabase
   - They're automatically refreshed when expired

4. **Regular security reviews**:
   - Monitor Supabase logs
   - Review API access patterns

---

## Next Steps

After successful setup:

1. **Deploy to production**: 
   - Update `REDIRECT_URI` in `strava_config.js` to your production domain
   - Update callback domain in Strava API settings

2. **Customize activity display**:
   - Edit `script.js` to show additional activity metrics
   - Customize the activity card styling in `dashboard.html`

3. **Add more features**:
   - Activity filtering by type
   - Monthly/weekly statistics
   - Activity goals and achievements
   - Leaderboard integration with real Strava data

---

## Support

If you encounter issues:
1. Check the browser console for errors (F12)
2. Review Supabase logs
3. Verify all setup steps were completed
4. Check the Strava API documentation: https://developers.strava.com/docs/

---

**Congratulations! Your Strava integration is now complete! 🎉**
