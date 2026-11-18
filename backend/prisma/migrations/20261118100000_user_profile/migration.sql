-- People directory: designation (title already exists), department, phone, employee id,
-- forced password change for admin-created accounts; invitations carry designation and department.
ALTER TABLE "User" ADD COLUMN "department" TEXT, ADD COLUMN "phone" TEXT, ADD COLUMN "employeeId" TEXT,
  ADD COLUMN "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Invitation" ADD COLUMN "title" TEXT, ADD COLUMN "department" TEXT;
