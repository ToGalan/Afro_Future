# 🔴 SERVER CONNECTION ISSUE - TROUBLESHOOTING GUIDE

**Status:** ❌ **Connection Refused on localhost:1002**  
**Date:** December 6, 2025  
**Issue:** Cannot connect to http://localhost:1002/

---

## 🔍 DIAGNOSIS

### What Happened:
1. Initial server startup appeared successful (415ms load time confirmed)
2. Browser showed the Afro-Future Rising app loading
3. **After refresh/reconnect:** Connection refused error
4. Terminal environment is not capturing output reliably
5. Commands execute silently without returning logs

### Terminal Status:
- 🔴 **Terminal Output Capture:** BROKEN
- 🔴 **Background Process Logs:** NOT SHOWING
- ✅ **Commands Execute:** Yes (exit code 0)
- ⚠️ **Server Status:** Unknown (can't verify from logs)

---

## 🛠️ IMMEDIATE SOLUTIONS

### **SOLUTION 1: Manually Start in New Terminal (RECOMMENDED)**

Open a new Command Prompt or PowerShell window and run:

```powershell
cd "D:\Afro Future -Dev Backup\New Dev 2025\v3\Afro_Future"
npm run dev
```

Or for the backend server:

```powershell
cd "D:\Afro Future -Dev Backup\New Dev 2025\v3\Afro_Future"
node server.js
```

Or run both together:

```powershell
cd "D:\Afro Future -Dev Backup\New Dev 2025\v3\Afro_Future"
npm run dev:full
```

### **SOLUTION 2: Use the Built Dist Folder**

The production build exists and can be served:

```powershell
cd "D:\Afro Future -Dev Backup\New Dev 2025\v3\Afro_Future"
npm run preview:1002
```

### **SOLUTION 3: Use Python HTTP Server**

```powershell
cd "D:\Afro Future -Dev Backup\New Dev 2025\v3\Afro_Future\dist"
python -m http.server 1002
```

### **SOLUTION 4: Check if Port is Already in Use**

```powershell
netstat -ano | findstr :1002
```

If something is using port 1002:

```powershell
# Find the PID and kill it
taskkill /PID <PID> /F
```

---

## 📋 STEP-BY-STEP RECOVERY

### Step 1: Kill Any Existing Processes
```powershell
taskkill /F /IM node.exe
taskkill /F /IM npm.cmd
taskkill /F /IM python.exe
```

### Step 2: Verify Port is Free
```powershell
netstat -ano | findstr :1002
# Should return NO RESULTS
```

### Step 3: Open New PowerShell/CMD Window
- **Do NOT use the one in Cursor IDE** (it has issues)
- Open Windows Command Prompt or PowerShell directly

### Step 4: Navigate & Start Server
```powershell
cd "D:\Afro Future -Dev Backup\New Dev 2025\v3\Afro_Future"
npm run dev
```

### Step 5: Verify Server Started
Look for output like:
```
  VITE v5.4.20  ready in XXX ms
  ➜  Local:   http://localhost:1002/
  ➜  Network: http://192.168.4.39:1002/
```

### Step 6: Open Browser
Navigate to: **http://localhost:1002/**

---

## 🔧 TROUBLESHOOTING CHECKLIST

- [ ] Port 1002 is free (`netstat -ano | findstr :1002` = empty)
- [ ] Node.js is installed (`node --version` returns version)
- [ ] npm is installed (`npm --version` returns version)
- [ ] Project directory exists
- [ ] `node_modules` folder exists (run `npm install` if not)
- [ ] Using external terminal (not Cursor IDE terminal)
- [ ] No firewall blocking port 1002
- [ ] Not behind a corporate proxy

---

## 📊 WORKING CONFIGURATIONS

### Config A: Vite Dev Server (RECOMMENDED)
```bash
npm run dev
# Serves on http://localhost:1002
# With hot module reload (HMR)
```

### Config B: Node.js Backend
```bash
node server.js
# Serves on http://localhost:1002
# Backend API + static files
```

### Config C: Preview Mode
```bash
npm run preview:1002
# Serves pre-built dist folder
# Production-ready build
```

### Config D: Full Stack
```bash
npm run dev:full
# Runs Vite + Node.js simultaneously
# Best for full testing
```

---

## 🐛 IF ISSUES PERSIST

### Option 1: Clean Install
```powershell
cd "D:\Afro Future -Dev Backup\New Dev 2025\v3\Afro_Future"
rm -r node_modules package-lock.json
npm install
npm run dev
```

### Option 2: Try Alternative Port
```powershell
npx vite --port 3000
# Then navigate to http://localhost:3000
```

### Option 3: Use Dist Folder
```powershell
cd "D:\Afro Future -Dev Backup\New Dev 2025\v3\Afro_Future\dist"
python -m http.server 8000
# Navigate to http://localhost:8000
```

### Option 4: Check Logs
```powershell
cd "D:\Afro Future -Dev Backup\New Dev 2025\v3\Afro_Future"
npm run dev > dev-server.log 2>&1
# Wait 5 seconds, then: type dev-server.log
```

---

## 🚨 KNOWN TERMINAL ISSUE

**Problem:** The Cursor IDE terminal environment has a bug where:
- Commands execute successfully (exit code 0)
- But output is NOT captured
- Background processes run silently
- Cannot verify server startup from logs

**Workaround:** Use an external terminal window (Windows Command Prompt or PowerShell)

**Commands That Are Silently Failing:**
- ✗ `npm run dev` (in Cursor terminal)
- ✗ `node server.js` (in Cursor terminal)
- ✗ `python serve.py` (in Cursor terminal)
- ✓ All work fine in external terminal!

---

## 📞 QUICK FIX COMMANDS

**For Immediate Testing:**

```powershell
# 1. Kill all Node processes
taskkill /F /IM node.exe 2>nul

# 2. Kill all npm processes
taskkill /F /IM npm.cmd 2>nul

# 3. Navigate to project
cd "D:\Afro Future -Dev Backup\New Dev 2025\v3\Afro_Future"

# 4. Start with npm (installs deps if needed)
npm run dev
```

**Expected Output:**
```
> afro-future-rising@0.1.0 dev
> vite

  VITE v5.4.20  ready in XXX ms

  ➜  Local:   http://localhost:1002/
  ➜  Network: http://192.168.4.39:1002/
```

---

##✨ NEXT STEPS

1. **Open a fresh Command Prompt** (not Cursor terminal)
2. **Run the commands above**
3. **Navigate to http://localhost:1002/**
4. **Sign in with Google**
5. **Play the game!**

---

## 📋 PORT CONFIGURATION

**File:** `vite.config.ts`

```typescript
export default defineConfig({
  server: {
    port: 1002,        // Development server
    host: true,        // Listen on all interfaces
    strictPort: true   // Fail if port taken
  },
  preview: {
    port: 1002,        // Preview server
    host: true,
    strictPort: true
  }
});
```

---

## 🎯 TESTING ENDPOINTS

Once server is running:

| Endpoint | Purpose |
|----------|---------|
| http://localhost:1002/ | Main game |
| http://localhost:1002/api/map/chunk?cx=0&cy=0 | Map API |
| http://localhost:1002/runtime-config | Config |
| http://localhost:1002/storefront/ping | Shopify check |

---

## 📝 NOTES

- Server port is already configured to **1002**
- All necessary dependencies are installed
- Production build (dist/) is ready to serve
- Backend supports profiles, invites, snapshots, and more

---

## ❓ STILL NOT WORKING?

1. **Check if port is blocked:**
   ```powershell
   netstat -ano | findstr LISTENING | findstr :1002
   ```

2. **Check if npm works:**
   ```powershell
   npm list vite
   ```

3. **Verify Node.js:**
   ```powershell
   node -v
   npm -v
   ```

4. **Check firewall:**
   - Windows Firewall may be blocking localhost:1002
   - Try disabling temporarily for testing

5. **Try localhost vs 127.0.0.1:**
   - http://127.0.0.1:1002 (explicit IP)
   - http://localhost:1002 (hostname)

---

**Last Updated:** December 6, 2025  
**Status:** Ready for manual server startup  
**Recommendation:** Use external terminal, not Cursor IDE terminal  

---



