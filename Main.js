// ======= SUPABASE INITIALIZATION ======= //
const SUPABASE_URL = 'https://xvqiwbiryhztyrdfdfrf.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh2cWl3YmlyeWh6dHlyZGZkZnJmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDQ5NjM1MjUsImV4cCI6MjA2MDUzOTUyNX0.kLFHzTeVNGw_RfmktIUrTwAOu06ILvmVgF8YkfKyIGs';
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);



// Initialize real-time leaderboard updates
supabase
    .channel('scores')
    .on('postgres_changes', 
        { event: 'INSERT', schema: 'public', table: 'scores' }, 
        () => displayLeaderboard()
    )
    .subscribe();



// ======= AUTH FUNCTIONS ======= //
async function signUp() {
    const email = document.getElementById('signup-email').value.trim();
    const password = document.getElementById('signup-password').value;
    const nickname = document.getElementById('nickname').value.trim();

    try {
        setLoadingState(true);
        showAuthMessage('Creating account...', 'info');

        const { data, error } = await supabase.auth.signUp({
            email,
            password,
            options: {
                data: { nickname },
                emailRedirectTo: `${window.location.origin}/?type=signup`
            }
        });

        if (data.user) {
        // Store session in localStorage until confirmation
        localStorage.setItem('pendingVerification', JSON.stringify({
            email,
            expires: Date.now() + 600000 // 10 minutes
        }));
    }

        if (error) throw error;

        console.log('Signup data:', data);
        
        if (data.user?.identities?.length === 0) {
            showAuthMessage('Email already registered. Try logging in.');
            switchTab('login');
            return;
        }

        showVerificationScreen();
        startVerificationTimer();
        startVerificationChecks();

    } catch (error) {
        console.error('Signup error:', error);
        showAuthMessage(error.message || 'Registration failed');
    } finally {
        setLoadingState(false);
    }
}



async function handlePostConfirmation() {
    try {
        const { data: { user }, error } = await supabase.auth.getUser();
        if (error) throw error;
        
        if (user?.email_confirmed_at) {
            clearVerificationProcess();
            hideVerificationScreen();
            showAuthMessage('Email verified successfully!', 'success');
            setTimeout(hideAuth, 2000);
        } else {
            // Force session refresh if needed
            const { data: { session }, error } = await supabase.auth.getSession();
            if (session) {
                await supabase.auth.setSession(session);
            }
        }
    } catch (error) {
        console.error('Post-confirmation error:', error);
    }
}
async function handleEmailVerificationUpdate() {
    try {
        const { data: { user }, error } = await supabase.auth.getUser();
        if (error) throw error;
        
        if (user?.email_confirmed_at) {
            clearVerificationProcess();
            showAuthMessage('Email verified successfully!', 'success');
            setTimeout(hideAuth, 2000);
        }
    } catch (error) {
        console.error('Verification update error:', error);
    }
}



// ======= AUTH STATE HANDLER ======= //
supabase.auth.onAuthStateChange(async (event, session) => {
    console.log('Auth state changed:', event, session);

    // Handle email confirmation redirect
    if (window.location.search.includes('type=signup')) {
        await handlePostConfirmation();
        return;
    }

    if (event === 'USER_UPDATED') {
        await handleEmailVerificationUpdate();
    }
    
    switch (event) {
        case 'INITIAL_SESSION':
            // Handle initial load
            break;
            
        case 'SIGNED_IN':
            // Handle successful login
            hideAuth();
            hideVerificationScreen();
            displayLeaderboard();
            break;
            
        case 'SIGNED_OUT':
            // Handle logout
            break;
            
        case 'USER_UPDATED':
            const { data: { user } } = await supabase.auth.getUser();
            if (user?.email_confirmed_at) {
                clearVerificationProcess();
                showAuthMessage('Email verified successfully!', 'success');
                hideVerificationScreen();
                setTimeout(hideAuth, 2000);
            }
            break;
            
        case 'PASSWORD_RECOVERY':
            // Handle password reset
            break;
    }
});

async function signIn() {
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;

    const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password
    });

    if (error) {
        showAuthMessage(error.message);
        return;
    }
    
    hideAuth();
}

async function signInWithGoogle() {
    const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google'
    });

    if (error) showAuthMessage(error.message);
}

async function signOut() {
    const { error } = await supabase.auth.signOut();
    if (error) console.error('Logout error:', error);
}



let verificationTimer;
let verificationCheckInterval;

function startVerificationTimer() {
    clearVerificationProcess(); // Cleanup any existing timers
    
    let seconds = 60;
    const timerElement = document.getElementById('verification-timer');
    
    verificationTimer = setInterval(() => {
        timerElement.textContent = `You can resend in ${seconds} seconds`;
        
        if (seconds <= 0) {
            clearInterval(verificationTimer);
            timerElement.textContent = "Didn't receive the email?";
        }
        seconds--;
    }, 1000);
}

function startVerificationChecks() {
    verificationCheckInterval = setInterval(async () => {
        const isVerified = await checkVerificationStatus();
        if (isVerified) clearVerificationProcess();
    }, 5000);
}

function clearVerificationProcess() {
    clearInterval(verificationTimer);
    clearInterval(verificationCheckInterval);
}

window.addEventListener('beforeunload', clearVerificationProcess);


async function checkVerificationStatus() {
    try {
        // First check if we have an existing session
        const { data: { session }, error: sessionError } = await supabase.auth.getSession();
        
        if (sessionError) {
            // Handle special case for email confirmation
            if (window.location.search.includes('type=signup')) {
                const { data: { user }, error: userError } = await supabase.auth.getUser();
                
                if (user?.email_confirmed_at) {
                    // Clear URL parameters after successful verification
                    window.history.replaceState({}, document.title, window.location.pathname);
                    return true;
                }
            }
            throw sessionError;
        }

        const { data: { user }, error: userError } = await supabase.auth.getUser();
        if (userError) throw userError;

        if (user?.email_confirmed_at) {
            document.getElementById('verification-timer').textContent = 'Email verified!';
            setTimeout(() => {
                hideVerificationScreen();
            }, 1000);
            return true;
        }
        
        return false;
    } catch (error) {
        console.error('Verification check error:', error);
        return false;
    }
}

// Cleanup when leaving the page
window.addEventListener('beforeunload', () => {
    clearInterval(verificationTimer);
    clearInterval(verificationCheckInterval);
});

async function resendVerificationEmail() {
    const email = document.getElementById('signup-email').value;
    
    if (!email) {
        showAuthMessage('No email found to resend');
        return;
    }

    try {
        setLoadingState(true);
        showAuthMessage('Sending verification email...', 'info');
        
        const { error } = await supabase.auth.resend({
            type: 'signup',
            email,
            options: {
                emailRedirectTo: `${window.location.origin}/?type=signup`
            }
        });

        if (error) throw error;
        
        showAuthMessage('New verification email sent!', 'success');
        startVerificationTimer();
        
    } catch (error) {
        console.error('Resend error:', error);
        showAuthMessage(error.message || 'Failed to resend email');
    } finally {
        setLoadingState(false);
    }
}













// ======= SCORE FUNCTIONS ======= //
async function saveScore(newScore) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    // 1. First check if the user already has a score
    const { data: existingScores, error: fetchError } = await supabase
        .from('scores')
        .select('score')
        .eq('user_id', user.id)
        .limit(1);

    if (fetchError) {
        console.error('Error fetching existing score:', fetchError);
        return;
    }

    const nickname = user.user_metadata.nickname || user.email.split('@')[0];
    
    // 2. If no existing score, or new score is higher, update/insert
    if (existingScores.length === 0) {
        // Insert new score
        const { error } = await supabase
            .from('scores')
            .insert([{
                user_id: user.id,
                nickname: nickname,
                score: newScore
            }]);

        if (error) console.error('Score save error:', error);
    } else {
        const currentHighScore = existingScores[0].score;
        if (newScore > currentHighScore) {
            // Update existing score
            const { error } = await supabase
                .from('scores')
                .update({ 
                    score: newScore,
                    nickname: nickname,
                    created_at: new Date().toISOString()
                })
                .eq('user_id', user.id);

            if (error) console.error('Score update error:', error);
        }
    }

    // Refresh the leaderboard
    displayLeaderboard();
}

async function displayLeaderboard() {
    const { data, error } = await supabase
        .from('scores')
        .select('nickname, score')
        .order('score', { ascending: false })
        .limit(10);

    const scoresList = document.getElementById('scores-list');
    scoresList.innerHTML = '';

    (data || []).forEach(score => {
        const li = document.createElement('li');
        li.innerHTML = `
            <span class="nickname">${score.nickname}</span>
            <span class="score">${score.score}</span>
        `;
        scoresList.appendChild(li);
    });
}


// ======= VERIFICATION SCREEN FUNCTIONS ======= //

function showVerificationScreen() {
    document.getElementById('verification-screen').style.display = 'block';
    hideAuth();
}
function hideVerificationScreen(){
    document.getElementById('verification-screen').style.display = 'none';
}


function setLoadingState(isLoading) {
    document.querySelectorAll('.auth-btn').forEach(btn => {
        btn.disabled = isLoading;
        btn.innerHTML = isLoading ? 
            '<span class="loader"></span>' : 
            btn.textContent;
    });
}

function showAuthMessage(message, type = 'error') {
    const messageEl = document.getElementById('auth-message');
    messageEl.textContent = message;
    messageEl.style.color = type === 'error' ? '#ff4444' : 
                          type === 'success' ? '#00C851' : 
                          '#33b5e5';
    messageEl.style.display = message ? 'block' : 'none';
}



// ======= AUTH UI FUNCTIONS ======= //

function showAuth() {
    document.getElementById('auth-container').style.display = 'flex';
    switchTab('login'); // Reset to login tab when showing auth
}

function hideAuth() {
    document.getElementById('auth-container').style.display = 'none';
}

function switchTab(tab) {
    const loginForm = document.getElementById('login-form');
    const signupForm = document.getElementById('signup-form');
    const loginTab = document.getElementById('login-tab');
    const signupTab = document.getElementById('signup-tab');

    if (tab === 'login') {
        loginForm.classList.add('active');
        signupForm.classList.remove('active');
        loginTab.classList.add('active');
        signupTab.classList.remove('active');
        document.getElementById('switch-text').textContent = "Don't have an account?";
        document.querySelector('.switch-mode').textContent = "Sign up instead";
    } else {
        signupForm.classList.add('active');
        loginForm.classList.remove('active');
        signupTab.classList.add('active');
        loginTab.classList.remove('active');
        document.getElementById('switch-text').textContent = "Already have an account?";
        document.querySelector('.switch-mode').textContent = "Login instead";
    }
}

function toggleAuthMode() {
    const loginForm = document.getElementById('login-form');
    if (loginForm.classList.contains('active')) {
        switchTab('signup');
    } else {
        switchTab('login');
    }
}

// ======= INITIALIZATION ======= //
document.addEventListener('DOMContentLoaded', function() {
    // Set up button event listeners
    document.querySelector('#left-panel button').addEventListener('click', showAuth);
    displayLeaderboard();
});

//------------------------------------------------------------------------------------------------------------------
//------------------------------------------------------------------------------------------------------------------
//------------------------------------------------------------------------------------------------------------------
//------------------------------------------------------------------------------------------------------------------
//------------------------------------------------------------------------------------------------------------------
//------------------------------------------------------------------------------------------------------------------
//------------------------------------------------------------------------------------------------------------------
//------------------------------------------------------------------------------------------------------------------
//------------------------------------------------------------------------------------------------------------------
//------------------------------------------------------------------------------------------------------------------
//------------------------------------------------------------------------------------------------------------------
//------------------------------------------------------------------------------------------------------------------



let outerMid = document.getElementsByClassName('outer-mid')[0];
let outerRect = outerMid.getBoundingClientRect();

let bird = document.getElementsByClassName('bird')[0];

// Gravity and jump strength scaled to outerMid height for responsiveness

const gravity = outerMid.offsetHeight * 0.00023// Scaled gravity strength
const jumpStrength = -outerMid.offsetHeight * 0.008; // Scaled jump strength

let isJumping = false; 
const ground = outerMid.offsetHeight - bird.offsetHeight; // Dynamic ground level based on container height

let gameRunning = false; // Control game state
let gameHold = false;

// initital bird img
bird.innerHTML = '<img src="img/bird-up.png" class="bird-img"></img>';






// Score Mechanism 

let score = 0; // Initialize score
let scoreElement = document.getElementById('score'); // The HTML element where the score is displayed

function updateScore() {
    const scoreElement = document.querySelector('#score span');
    scoreElement.textContent = `${++score}`;

    // Add the pulse class for the scaling animation
    scoreElement.classList.add('pulse');
    
    // Remove the pulse class after the animation duration
    setTimeout(() => {
        scoreElement.classList.remove('pulse');
    }, 200); // Match this with the duration of the scaling transition
}






document.addEventListener('keydown' , function(event) {
    if (event.code === 'Space') {
        isJumping = true;
        velocity = jumpStrength;

        bird.innerHTML = '<img src="img/bird-up.png" class="bird-img"></img>';

        if (!gameRunning && !gameHold) {
            gameRunning = true;
            applyGravity();
            moveBars(right[0]);
        }
    }
});



document.addEventListener('touchstart' , function(event) {
    isJumping = true;
    velocity = jumpStrength;

    bird.innerHTML = '<img src="img/bird-up.png" class="bird-img"></img>';

    if (!gameRunning && !gameHold) {
        gameRunning = true;
        applyGravity();
        moveBars(right[0]);
    }
});

document.addEventListener('keyup', function(event) {
    if (event.code === 'Space') {
        isJumping = false;
    }

    bird.innerHTML = '<img src="img/bird-down.png" class="bird-img"></img>';
});

document.addEventListener('touchend', function(event) {
    isJumping = false;

    bird.innerHTML = '<img src="img/bird-down.png" class="bird-img"></img>';
});

let outerTop = outerRect.top;

function applyGravity() {
    if (!gameRunning) return;

    if (!isJumping) {
        velocity += gravity; // Apply gravity
    }

    let rect = bird.getBoundingClientRect();
    let newTop = rect.top - outerTop + velocity;

    // Prevent bird from going below ground or above the container
    if (newTop > ground) {
        newTop = ground;
        velocity = 0;
    } else if (newTop < 0) {
        newTop = 0;
        velocity = 0;
    }

    bird.style.top = newTop + 'px';

    requestAnimationFrame(applyGravity);
}






// Bar Movement

let bar1 = {
    a: document.getElementsByClassName('bar-1a')[0],
    b: document.getElementsByClassName('bar-1b')[0]
};

let bar2 = {
    a: document.getElementsByClassName('bar-2a')[0],
    b: document.getElementsByClassName('bar-2b')[0]
};

let bar3 = {
    a: document.getElementsByClassName('bar-3a')[0],
    b: document.getElementsByClassName('bar-3b')[0]
};

let bar4 = {
    a: document.getElementsByClassName('bar-4a')[0],
    b: document.getElementsByClassName('bar-4b')[0]
};

let right = [bar1, bar2, bar3, bar4];
let left = [];

let initialGap = outerMid.offsetHeight * 0.4; // Scaled initial gap between bars
let gap = initialGap;
let min = outerMid.offsetHeight * 0.2; // Scaled min bar height
let max = outerMid.offsetHeight * 0.4; // Scaled max bar height

let gapDecreaseFactor = outerMid.offsetHeight * 0.0005; // Scale gap decrease factor
let initialBarVelocity = outerMid.offsetWidth * 0.003; // Scale bar speed based on container width

let barVelocity = initialBarVelocity;

let barGapFactor = 0.6;
if(window.innerWidth < 750)barGapFactor = 0.5;

let speedIncreaseFactor = outerMid.offsetWidth * 0.00003; // Scale speed increase factor

function getRandomNumber() {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function setgap(bar) {
    let random = getRandomNumber();
    bar.a.style.height = `${random}px`;
    bar.b.style.height = `${outerMid.offsetHeight - gap - random}px`;
    return bar;
}

function moveBars(bar) {
    if (!gameRunning) return;

    detectCollision(bar);
    bar = setgap(bar);

    left.push(bar);
    right.shift();

    let barPos = outerMid.offsetWidth; // Bar starting position is scaled to container width
    let first1 = true;

    function updatebars() {
        if (!gameRunning) return;

        if (barPos <= -30) {
            bar.a.style.left = `${outerMid.offsetWidth + 20}px`;
            bar.b.style.left = `${outerMid.offsetWidth + 20}px`;
            right.push(bar);
            left.shift();
            return;
        }

        if (barPos <= outerMid.offsetWidth * barGapFactor && first1) {
            first1 = false;
            moveBars(right[0]);
        }

        barPos -= barVelocity; // Move bar with scaled velocity
        bar.a.style.left = `${barPos}px`;
        bar.b.style.left = `${barPos}px`;

        requestAnimationFrame(updatebars);
    }

    updatebars();
}

// Gradually increase bar speed during gameplay
function increaseBarSpeed() {
    barVelocity += speedIncreaseFactor; // Increase speed over time
}

function decreaseGap() {
    gap -= gapDecreaseFactor; // Decrease the gap between bars
}

setInterval(function() {
    if (gameRunning) {
        increaseBarSpeed();
        decreaseGap();
    }
}, 100);

// Detecting Collision

function detectCollision(bar) {
    let tobreak = true;

    let ScoreFirst = true; // toggle variable so the score won't get incremented multiple times after each bar
    

    function checkCollision() {
        if (!tobreak || !gameRunning) return;

        let birdRect = bird.getBoundingClientRect();
        let bar1Rect = bar.a.getBoundingClientRect();
        let bar2Rect = bar.b.getBoundingClientRect();

        

        if (birdRect.left < bar1Rect.right) {

            if (
                (birdRect.right > bar1Rect.left && birdRect.top < bar1Rect.bottom) ||
                (birdRect.bottom > bar2Rect.top && birdRect.right > bar2Rect.left)
            ) {
                gameRunning = false;
                tobreak = false;

                saveScore(score);

                const outerElement = document.querySelector('.outer');
                outerElement.classList.add('shake');

                let gameOver = document.getElementById('game-over');

                gameOver.style.display = 'block';
                gameOver.style.opacity = '0';

                setTimeout(() => {
                    gameOver.style.transition = 'opacity 1s ease';
                    gameOver.style.opacity = '1';
                }, 100);

                setTimeout(() => {
                    outerElement.classList.remove('shake');
                }, 500);

                bird.style.transition = 'top 2s ease, opacity 2s ease';
                bird.style.top = `${ground}px`;
                bird.style.opacity = '0';

                gameHold = true;

                setTimeout(resetGame, 2000);

                setTimeout(() => {
                    gameHold = false;
                }, 2000);
            }
        }else{
            if(ScoreFirst){
                updateScore();
                ScoreFirst = false;
            }
        }

        if (gameRunning) {
            requestAnimationFrame(checkCollision);
        }
    }

    checkCollision();
}

// Reset Game Function
function resetGame() {
    resetBars();

    gap = initialGap; // Reset the gap
    score = -1;
    updateScore();

    document.getElementById('game-over').style.display = 'none';

    bird.style.opacity = '1';
    bird.style.transition = '';

    bird.style.top = `${outerMid.offsetHeight * 0.4}px`; // Reset bird position
    velocity = 0;
    isJumping = false;
    gameRunning = false;

    barVelocity = initialBarVelocity; // Reset bar velocity
}

// Reset Bar Positions
function resetBars() {
    right = [bar1, bar2, bar3, bar4];

    right.forEach(bar => {
        bar.a.style.left = `${outerMid.offsetWidth}px`;
        bar.b.style.left = `${outerMid.offsetWidth}px`;
    });
}