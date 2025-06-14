# Stack Auth Debugging & Re-Enabling Guide

## Current Status: TEMPORARILY DISABLED

Stack Auth is currently completely disabled to eliminate toClientJson errors.
All Stack Auth code is preserved in comments for easy re-enabling.

## Console Status Check:

### Expected Current Logs (Stack Auth Disabled):
```
StackAuthProvider: TEMPORARILY DISABLING Stack Auth to resolve toClientJson errors
UserSystem: TEMPORARILY DISABLING Stack Auth - using guest mode only
```

### If toClientJson errors persist:
- Clear browser cache and hard refresh
- Check no other components are calling Stack Auth
- Verify latest commits deployed

## Re-Enabling Process:

### 1. Update StackAuthProvider.tsx:
- Uncomment original Stack Auth initialization code
- Remove temporary disable logic
- Test basic provider functionality

### 2. Update UserSystem.tsx with Improved Defensive Pattern:

```tsx
const StackAuthHookUser = () => {
  if (!stackComponents) return null;

  try {
    const { useUser } = stackComponents;
    
    // Enhanced defensive useUser call
    const stackUser = typeof useUser === 'function' ? useUser() : null;
    
    // Debug logging
    console.log('Stack User:', stackUser);
    console.log('Stack User type:', typeof stackUser);
    
    useEffect(() => {
      if (!stackUser) {
        console.log('UserSystem: No stack user, staying in guest mode');
        return;
      }
      
      // Enhanced defensive property access
      const convertedUser: UserInterface = {
        id: stackUser.id ?? 'unknown',
        username: stackUser.displayName ?? stackUser.primaryEmail?.split('@')[0] ?? 'User',
        email: stackUser.primaryEmail ?? '',
        role: 'user',
        avatar: '👤',
        joinDate: new Date().toISOString(),
        lastActive: new Date().toISOString(),
        scrollsMinted: 0,
        organizationId: undefined
      };

      setUser(convertedUser);
      onUserChange?.(convertedUser);
      console.log('UserSystem: User state updated successfully');
      
    }, [stackUser]);

    return null;
    
  } catch (error) {
    console.error('UserSystem: Error using useUser()', error);
    return null;
  }
};
```

### 3. Progressive Component Re-Enabling:

**Phase 1:** Basic useUser hook only
**Phase 2:** Add UserButton (most likely toClientJson source)
**Phase 3:** Full Stack Auth functionality

### 4. UserButton Isolation Test:

```tsx
// Temporarily comment out UserButton to test if it's the toClientJson source
{/* {stackComponents?.UserButton && <stackComponents.UserButton />} */}

// Replace with safe fallback:
<div style={{
  padding: '8px 12px',
  color: '#00ffff',
  fontSize: '12px',
  fontFamily: 'Orbitron, monospace'
}}>
  👤 {user.username}
</div>
```

## Environment Variables for Re-Enabling:

```
NEXT_PUBLIC_STACK_PROJECT_ID=st_tcutrWqiStGLyVSB
NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY=pck_gm5czs40jnc3r392p3t2p84re7510frhsg2zgs6vvgr3g
STACK_SECRET_SERVER_KEY=ssk_sthgw2r8dzt09s29cp0c2bm35pxfp01cs4ftn5nmm0qfr
```

## Testing Checklist:

- [ ] Clear browser cache before testing
- [ ] Check console for initialization logs
- [ ] Test useUser hook in isolation
- [ ] Gradually add UserButton
- [ ] Verify no toClientJson errors
- [ ] Test full authentication flow

## Known Issues to Watch:

1. **UserButton** - Most likely source of toClientJson calls
2. **StackProvider context** - May serialize user data internally
3. **Stack Auth hydration** - SSR/client mismatch issues

## Success Criteria:

- No toClientJson errors in console
- Successful user authentication
- Proper user state management
- Graceful fallback to guest mode
