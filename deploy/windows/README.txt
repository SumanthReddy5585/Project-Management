O2 Support Hub - Windows Server deployment package
==================================================
1. Install PostgreSQL 16/17 and Node.js 22 LTS (x64).
2. Extract this folder to C:\O2-Support-Hub
3. PowerShell (Run as administrator):
     cd C:\O2-Support-Hub
     powershell -ExecutionPolicy Bypass -File .\scripts\install.ps1
     powershell -ExecutionPolicy Bypass -File .\scripts\install-service.ps1
4. HTTPS with IIS, backups, updates, troubleshooting: README-DEPLOY-WINDOWS.md
Database scripts and structure reference: database\README-DATABASE.md
