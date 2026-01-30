// Supabase Configuration (Global Version)
// Note: Supabase library is loaded via CDN in the HTML file

const S_URL = 'https://mnlpbjkkugugtkkrrnpm.supabase.co';
const S_KEY = 'sb_publishable_HgnKoRJ3XYm6WZd2lldSBQ_KBxgGXRz';

// We attach it to window so all standard scripts can access it
if (window.supabase) {
    // Create the client and attach it to a specific global alias 'supabaseClient'
    // We DO NOT overwrite 'window.supabase' because that is the library itself
    window.supabaseClient = window.supabase.createClient(S_URL, S_KEY);
    console.log('Supabase Client Initialized as window.supabaseClient');
} else {
    console.warn('Supabase library not yet loaded. Ensure CDN script is present.');
}
