import { createClient } from '@supabase/supabase-js';
import bcrypt from 'bcryptjs';
import { applyCors } from './utils/cors.js';
import { signSessionToken } from './utils/session.js';

export default async (req, res) => {
    applyCors(req, res, 'POST, OPTIONS');

    // Handle preflight requests
    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    try {
        if (req.method === 'POST') {
            const { email, password } = req.body;
            
            if (!email || !password) {
                return res.status(400).json({ 
                    success: false, 
                    message: 'Email and password are required.' 
                });
            }
            
            // Use Supabase client for login (more reliable for authentication)
            // Use service role key to bypass RLS for server-side authentication
            const supabaseUrl = process.env.SUPABASE_URL;
            const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
            const supabaseKey = process.env.SUPABASE_PUBLISHABLE_KEY;
            
            if (!supabaseUrl || !supabaseServiceKey) {
                console.error('Supabase credentials not found');
                return res.status(500).json({ 
                    success: false, 
                    message: 'Database configuration error'
                });
            }
            
            // Use service role key for server-side queries (bypasses RLS)
            const supabase = createClient(supabaseUrl, supabaseServiceKey, {
                auth: {
                    autoRefreshToken: false,
                    persistSession: false
                }
            });
            
            let users;
            try {
                const { data, error } = await supabase
                    .from('users')
                    .select('*')
                    .eq('email', email);
                
                if (error) {
                    console.error('[Login] Supabase query error:', error);
                    return res.status(500).json({ 
                        success: false, 
                        message: 'Database query failed',
                        error: error.message
                    });
                }
                
                users = data || [];
            } catch (error) {
                console.error('[Login] Database query failed:', error);
                return res.status(500).json({ 
                    success: false, 
                    message: 'Database query failed',
                    error: error.message
                });
            }
            
            if (users.length > 0) {
                const user = users[0];
                
                if (!user.password_hash) {
                    return res.status(401).json({ 
                        success: false, 
                        message: 'User account not properly configured.' 
                    });
                }
                
                let isPasswordMatch;
                try {
                    isPasswordMatch = await bcrypt.compare(password, user.password_hash);
                } catch (error) {
                    console.error('Password comparison failed:', error);
                    return res.status(500).json({ 
                        success: false, 
                        message: 'Password comparison failed',
                        error: error.message
                    });
                }

                if (isPasswordMatch) {
                    // Create or get Supabase Auth user for storage access
                    // Use service role key to create/manage auth users
                    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
                    let supabaseAuthSession = null;
                    
                    if (supabaseServiceKey) {
                        try {
                            const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
                                auth: {
                                    autoRefreshToken: false,
                                    persistSession: false
                                }
                            });
                            
                            // Check if auth user exists
                            const { data: authUsersData } = await supabaseAdmin.auth.admin.listUsers();
                            let authUser = authUsersData?.users?.find(u => u.email === email);
                            
                            if (!authUser) {
                                // Create new auth user (no password - we use custom auth)
                                const { data: newAuthUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
                                    email: email,
                                    email_confirm: true, // Auto-confirm email
                                    user_metadata: {
                                        user_id: user.user_id,
                                        role: user.role
                                    }
                                });
                                
                                if (createError) {
                                    console.warn('Could not create Supabase Auth user:', createError);
                                } else {
                                    authUser = newAuthUser.user;
                                }
                            }
                            
                            // Create a session for the auth user
                            // Since we use custom auth, we'll set a temporary password and sign in
                            if (authUser) {
                                // Generate a temporary password (not stored, just for session creation)
                                const tempPassword = `temp_${Date.now()}_${Math.random().toString(36).substring(7)}`;
                                
                                // Update the auth user with this temporary password using admin API
                                const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(
                                    authUser.id,
                                    { password: tempPassword }
                                );
                                
                                if (!updateError) {
                                    // Create a regular client (with anon key) to sign in
                                    const supabaseClient = createClient(supabaseUrl, supabaseKey);
                                    
                                    // Sign in with the temporary password to get a session
                                    const { data: signInData, error: signInError } = await supabaseClient.auth.signInWithPassword({
                                        email: email,
                                        password: tempPassword
                                    });
                                    
                                    if (!signInError && signInData?.session) {
                                        supabaseAuthSession = {
                                            access_token: signInData.session.access_token,
                                            refresh_token: signInData.session.refresh_token,
                                        };
                                        console.log('✅ Supabase Auth session created successfully');
                                    } else if (signInError) {
                                        console.warn('Could not sign in to create session:', signInError);
                                    }
                                } else {
                                    console.warn('Could not set temporary password:', updateError);
                                }
                            }
                        } catch (authError) {
                            // Log but don't fail login - storage might still work
                            console.warn('Could not create Supabase Auth session:', authError);
                        }
                    }
                    
                    let sessionToken;
                    try {
                        sessionToken = signSessionToken(user.user_id);
                    } catch (signError) {
                        console.error('Could not sign session token:', signError);
                        return res.status(500).json({
                            success: false,
                            message: 'Server configuration error'
                        });
                    }

                    const { password_hash, ...userToSend } = user;
                    res.json({ 
                        success: true, 
                        user: userToSend,
                        sessionToken,
                        supabaseSession: supabaseAuthSession // Include session tokens if available
                    });
                } else {
                    res.status(401).json({ 
                        success: false, 
                        message: 'Invalid email or password.' 
                    });
                }
            } else {
                res.status(401).json({ 
                    success: false, 
                    message: 'Invalid email or password.' 
                });
            }
        } else {
            res.status(405).json({ 
                success: false, 
                message: 'Method not allowed' 
            });
        }
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'An internal server error occurred.'
        });
    }
};
