# Custom Spotify Credentials Feature

## Overview
Users can now configure their own Spotify Developer credentials to bypass the access restriction that requires being added to the app's developer dashboard.

## Features

### 1. Settings Modal
- ⚙️ Settings button in header (top right)
- Configure custom Client ID, Client Secret, and Redirect URI
- Credentials stored in localStorage
- Clear button to revert to default credentials

### 2. Updated Access Denied Overlay
Shows two options when access is denied:
- **Option 1**: Request access via email
- **Option 2**: Set up own Spotify Developer app (with step-by-step instructions)

### 3. Custom OAuth Flow
- Uses custom credentials when available
- Falls back to default server credentials
- Secure token exchange via server endpoint

## User Flow

### Setting Up Custom Credentials

1. User clicks ⚙️ Settings button
2. Fills in:
   - **Client ID**: From Spotify Developer Dashboard
   - **Client Secret**: From Spotify Developer Dashboard  
   - **Redirect URI**: Must match app settings (default: `http://localhost:8888/callback`)
3. Clicks "Save Credentials"
4. Refreshes page
5. Logs in with their own credentials

### Getting Spotify Credentials

Detailed instructions provided in:
- Settings modal (expandable "How to get your own credentials")
- Access Denied overlay (Option 2)

Steps:
1. Go to [Spotify Developer Dashboard](https://developer.spotify.com/dashboard)
2. Log in with Spotify account
3. Click "Create app"
4. Fill in app details:
   - Name: Music Story (or any name)
   - Description: Personal music documentary player
   - Redirect URI: `http://localhost:8888/callback`
   - APIs: Check "Web Playback SDK"
5. Save and copy Client ID and Secret
6. Paste into Settings modal

## Technical Implementation

### Frontend (`public/player.js`)

**Credentials Management:**
```javascript
- getCustomCredentials() - Retrieve from localStorage
- saveCustomCredentials() - Store in localStorage
- clearCustomCredentials() - Remove from localStorage
- hasCustomCredentials() - Check if configured
```

**Auth Flow:**
- Login button checks for custom credentials
- Uses `/login-custom` endpoint if configured
- Uses default `/login` if not
- Handles auth code exchange with custom credentials

### Backend (`src/routes/customAuth.js`)

**Endpoints:**
- `GET /login-custom` - Initiates OAuth with custom client_id
- `POST /api/exchange-code` - Exchanges auth code for tokens (server-side to keep secret secure)
- `GET /refresh_token-custom` - Refreshes tokens with custom credentials

### HTML (`public/player.html`)

**New Elements:**
- Settings button (⚙️)
- Settings modal with form
- Updated Access Denied overlay with two options
- Step-by-step instructions

### CSS (`public/styles.css`)

**New Styles:**
- `.icon-btn` - Settings button styling
- `.settings-*` - Modal and form styling
- `.access-option` - Two-option layout for access denied
- `.form-group` - Form field styling

## Security

- ✅ Client Secret stored in localStorage (client-side only)
- ✅ Token exchange happens server-side
- ✅ Credentials never exposed in URLs
- ✅ Can clear credentials anytime
- ⚠️ localStorage is not encrypted (acceptable for personal use)

## Benefits

1. **No Access Restrictions**: Users can use their own Spotify app
2. **Self-Service**: No need to email for access
3. **Quick Setup**: Takes 2 minutes to create Spotify app
4. **Privacy**: Users control their own credentials
5. **Flexibility**: Can switch between default and custom credentials

## Usage

### For Users Without Access

When you see "Access Required" error:
1. Click "Open Settings" button
2. Follow instructions to create Spotify app
3. Copy credentials into settings
4. Refresh and log in

### For Users With Custom Credentials

Settings button shows current configuration:
- Green indicator if custom credentials active
- Can clear and revert to default anytime

## Fallback Behavior

- If custom credentials fail → Shows error, redirects to login
- If custom credentials cleared → Uses default server credentials
- If no credentials at all → Redirects to home page

## Testing

1. **Test custom auth flow:**
   - Set custom credentials
   - Log in
   - Verify token exchange works
   - Generate documentary

2. **Test fallback:**
   - Clear custom credentials
   - Log in with default
   - Verify works normally

3. **Test error handling:**
   - Enter invalid credentials
   - Verify error message
   - Verify redirect to home

## Future Enhancements

- [ ] Encrypt credentials in localStorage
- [ ] Validate credentials before saving
- [ ] Show credential status indicator
- [ ] Export/import credentials
- [ ] Multiple credential profiles
