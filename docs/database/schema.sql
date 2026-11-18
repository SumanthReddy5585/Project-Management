-- O2 Support Hub - database schema (PostgreSQL 14+)
-- Creates every table, enum, index and foreign key on an EMPTY database, and marks the 3 migrations as applied.
-- psql -U o2app -d o2_support_hub -f schema.sql

--
-- PostgreSQL database dump
--


-- Dumped from database version 16.15 (Ubuntu 16.15-0ubuntu0.24.04.1)
-- Dumped by pg_dump version 16.15 (Ubuntu 16.15-0ubuntu0.24.04.1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: ApprovalDecision; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."ApprovalDecision" AS ENUM (
    'APPROVED',
    'CHANGES_REQUESTED'
);


--
-- Name: ChangeRequestStatus; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."ChangeRequestStatus" AS ENUM (
    'SUBMITTED',
    'UNDER_REVIEW',
    'APPROVED',
    'REJECTED',
    'IMPLEMENTED'
);


--
-- Name: DeliverableStatus; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."DeliverableStatus" AS ENUM (
    'DRAFT',
    'IN_REVIEW',
    'APPROVED',
    'CHANGES_REQUESTED'
);


--
-- Name: DependencyType; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."DependencyType" AS ENUM (
    'FS',
    'SS',
    'FF',
    'SF'
);


--
-- Name: Health; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."Health" AS ENUM (
    'GREEN',
    'AMBER',
    'RED'
);


--
-- Name: MembershipStatus; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."MembershipStatus" AS ENUM (
    'ACTIVE',
    'DISABLED'
);


--
-- Name: OrgRole; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."OrgRole" AS ENUM (
    'ADMIN',
    'MANAGER',
    'EMPLOYEE',
    'CUSTOMER'
);


--
-- Name: Priority; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."Priority" AS ENUM (
    'LOW',
    'MEDIUM',
    'HIGH',
    'CRITICAL'
);


--
-- Name: ProjectRole; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."ProjectRole" AS ENUM (
    'MANAGER',
    'MEMBER',
    'VIEWER',
    'CUSTOMER'
);


--
-- Name: ProjectStatus; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."ProjectStatus" AS ENUM (
    'DRAFT',
    'ACTIVE',
    'ON_HOLD',
    'COMPLETED',
    'CANCELLED',
    'ARCHIVED'
);


--
-- Name: RegisterStatus; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."RegisterStatus" AS ENUM (
    'OPEN',
    'IN_PROGRESS',
    'CLOSED'
);


--
-- Name: TicketStatus; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."TicketStatus" AS ENUM (
    'NEW',
    'OPEN',
    'IN_PROGRESS',
    'WAITING_ON_CUSTOMER',
    'RESOLVED',
    'CLOSED'
);


--
-- Name: TicketType; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."TicketType" AS ENUM (
    'BUG',
    'SERVICE_REQUEST',
    'QUESTION',
    'CHANGE_REQUEST'
);


--
-- Name: TimesheetStatus; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."TimesheetStatus" AS ENUM (
    'DRAFT',
    'SUBMITTED',
    'APPROVED',
    'REJECTED'
);


--
-- Name: Visibility; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."Visibility" AS ENUM (
    'INTERNAL',
    'PUBLIC'
);


--
-- Name: WorkItemType; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."WorkItemType" AS ENUM (
    'MODULE',
    'TASK',
    'SUBTASK',
    'MILESTONE'
);


--
-- Name: WorkStatus; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."WorkStatus" AS ENUM (
    'TODO',
    'IN_PROGRESS',
    'BLOCKED',
    'IN_REVIEW',
    'DONE',
    'CANCELLED'
);


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: Approval; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."Approval" (
    id uuid NOT NULL,
    "deliverableVersionId" uuid NOT NULL,
    "reviewerId" uuid NOT NULL,
    decision public."ApprovalDecision" NOT NULL,
    comment text,
    "createdAt" timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: AuditEvent; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."AuditEvent" (
    id uuid NOT NULL,
    "organizationId" uuid NOT NULL,
    "actorId" uuid,
    action text NOT NULL,
    "entityType" text NOT NULL,
    "entityId" text,
    "projectId" uuid,
    visibility public."Visibility" DEFAULT 'INTERNAL'::public."Visibility" NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    ip text,
    "createdAt" timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: Baseline; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."Baseline" (
    id uuid NOT NULL,
    "projectId" uuid NOT NULL,
    name text NOT NULL,
    note text,
    "createdById" uuid NOT NULL,
    "createdAt" timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: BaselineItem; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."BaselineItem" (
    id uuid NOT NULL,
    "baselineId" uuid NOT NULL,
    "workItemId" uuid NOT NULL,
    "plannedStart" date,
    "plannedFinish" date,
    "estimateHours" numeric(8,2)
);


--
-- Name: CannedResponse; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."CannedResponse" (
    id uuid NOT NULL,
    "organizationId" uuid NOT NULL,
    title text NOT NULL,
    body text NOT NULL,
    "createdById" uuid NOT NULL,
    "createdAt" timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) with time zone NOT NULL
);


--
-- Name: ChangeRequest; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."ChangeRequest" (
    id uuid NOT NULL,
    "projectId" uuid NOT NULL,
    title text NOT NULL,
    scope text NOT NULL,
    "scheduleImpactDays" integer DEFAULT 0 NOT NULL,
    "costImpact" numeric(14,2),
    "reviewerId" uuid,
    status public."ChangeRequestStatus" DEFAULT 'SUBMITTED'::public."ChangeRequestStatus" NOT NULL,
    "outcomeNote" text,
    "ticketId" uuid,
    "decidedAt" timestamp(3) with time zone,
    "createdById" uuid NOT NULL,
    "createdAt" timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: ChecklistItem; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."ChecklistItem" (
    id uuid NOT NULL,
    "workItemId" uuid NOT NULL,
    text text NOT NULL,
    done boolean DEFAULT false NOT NULL,
    "sortOrder" integer DEFAULT 0 NOT NULL
);


--
-- Name: Comment; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."Comment" (
    id uuid NOT NULL,
    "organizationId" uuid NOT NULL,
    "projectId" uuid,
    "workItemId" uuid,
    "ticketId" uuid,
    "discussionId" uuid,
    "authorId" uuid NOT NULL,
    body text NOT NULL,
    visibility public."Visibility" DEFAULT 'INTERNAL'::public."Visibility" NOT NULL,
    "createdAt" timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "editedAt" timestamp(3) with time zone,
    "deletedAt" timestamp(3) with time zone
);


--
-- Name: CustomerCompany; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."CustomerCompany" (
    id uuid NOT NULL,
    "organizationId" uuid NOT NULL,
    name text NOT NULL,
    domain text,
    notes text,
    "createdAt" timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: Decision; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."Decision" (
    id uuid NOT NULL,
    "projectId" uuid NOT NULL,
    title text NOT NULL,
    context text,
    decision text NOT NULL,
    "decidedById" uuid,
    "decidedOn" date NOT NULL,
    "workItemId" uuid,
    "createdAt" timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: Deliverable; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."Deliverable" (
    id uuid NOT NULL,
    "projectId" uuid NOT NULL,
    "phaseId" uuid,
    name text NOT NULL,
    description text,
    "customerVisible" boolean DEFAULT false NOT NULL,
    status public."DeliverableStatus" DEFAULT 'DRAFT'::public."DeliverableStatus" NOT NULL,
    "dueDate" date,
    version integer DEFAULT 1 NOT NULL,
    "createdAt" timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: DeliverableVersion; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."DeliverableVersion" (
    id uuid NOT NULL,
    "deliverableId" uuid NOT NULL,
    "versionNumber" integer NOT NULL,
    note text,
    "createdById" uuid NOT NULL,
    "createdAt" timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: Dependency; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."Dependency" (
    id uuid NOT NULL,
    "projectId" uuid NOT NULL,
    "predecessorId" uuid NOT NULL,
    "successorId" uuid NOT NULL,
    type public."DependencyType" DEFAULT 'FS'::public."DependencyType" NOT NULL,
    "lagDays" integer DEFAULT 0 NOT NULL,
    "createdAt" timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: Discussion; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."Discussion" (
    id uuid NOT NULL,
    "projectId" uuid NOT NULL,
    title text NOT NULL,
    visibility public."Visibility" DEFAULT 'INTERNAL'::public."Visibility" NOT NULL,
    "createdById" uuid NOT NULL,
    "createdAt" timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: FileBlob; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."FileBlob" (
    key text NOT NULL,
    data bytea NOT NULL,
    size integer NOT NULL,
    "createdAt" timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: FileObject; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."FileObject" (
    id uuid NOT NULL,
    "organizationId" uuid NOT NULL,
    "projectId" uuid,
    "workItemId" uuid,
    "ticketId" uuid,
    "deliverableVersionId" uuid,
    "storageKey" text NOT NULL,
    "originalName" text NOT NULL,
    "mimeType" text NOT NULL,
    size integer NOT NULL,
    sha256 text NOT NULL,
    visibility public."Visibility" DEFAULT 'INTERNAL'::public."Visibility" NOT NULL,
    "uploadedById" uuid NOT NULL,
    "createdAt" timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "deletedAt" timestamp(3) with time zone
);


--
-- Name: Holiday; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."Holiday" (
    id uuid NOT NULL,
    "calendarId" uuid NOT NULL,
    date date NOT NULL,
    name text NOT NULL
);


--
-- Name: Invitation; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."Invitation" (
    id uuid NOT NULL,
    "organizationId" uuid NOT NULL,
    email text NOT NULL,
    name text,
    role public."OrgRole" NOT NULL,
    "customerCompanyId" uuid,
    "tokenHash" text NOT NULL,
    "invitedById" uuid NOT NULL,
    "expiresAt" timestamp(3) with time zone NOT NULL,
    "acceptedAt" timestamp(3) with time zone,
    "revokedAt" timestamp(3) with time zone,
    "createdAt" timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    title text,
    department text
);


--
-- Name: Issue; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."Issue" (
    id uuid NOT NULL,
    "projectId" uuid NOT NULL,
    title text NOT NULL,
    description text,
    severity integer DEFAULT 3 NOT NULL,
    "ownerId" uuid,
    "targetDate" date,
    status public."RegisterStatus" DEFAULT 'OPEN'::public."RegisterStatus" NOT NULL,
    "workItemId" uuid,
    "createdAt" timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: KnowledgeArticle; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."KnowledgeArticle" (
    id uuid NOT NULL,
    "organizationId" uuid NOT NULL,
    title text NOT NULL,
    body text NOT NULL,
    category text DEFAULT 'General'::text NOT NULL,
    visibility public."Visibility" DEFAULT 'PUBLIC'::public."Visibility" NOT NULL,
    published boolean DEFAULT false NOT NULL,
    "authorId" uuid NOT NULL,
    views integer DEFAULT 0 NOT NULL,
    "helpfulYes" integer DEFAULT 0 NOT NULL,
    "helpfulNo" integer DEFAULT 0 NOT NULL,
    "createdAt" timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) with time zone NOT NULL
);


--
-- Name: Membership; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."Membership" (
    id uuid NOT NULL,
    "organizationId" uuid NOT NULL,
    "userId" uuid NOT NULL,
    role public."OrgRole" NOT NULL,
    status public."MembershipStatus" DEFAULT 'ACTIVE'::public."MembershipStatus" NOT NULL,
    "customerCompanyId" uuid,
    "createdAt" timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: Notification; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."Notification" (
    id uuid NOT NULL,
    "organizationId" uuid NOT NULL,
    "userId" uuid NOT NULL,
    type text NOT NULL,
    title text NOT NULL,
    body text,
    link text,
    "readAt" timestamp(3) with time zone,
    "emailStatus" text DEFAULT 'NOT_CONFIGURED'::text NOT NULL,
    "dedupeKey" text,
    "createdAt" timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: Organization; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."Organization" (
    id uuid NOT NULL,
    name text NOT NULL,
    slug text NOT NULL,
    timezone text DEFAULT 'UTC'::text NOT NULL,
    settings jsonb DEFAULT '{}'::jsonb NOT NULL,
    "ticketSeq" integer DEFAULT 0 NOT NULL,
    "createdAt" timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) with time zone NOT NULL
);


--
-- Name: PasswordResetToken; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."PasswordResetToken" (
    id uuid NOT NULL,
    "userId" uuid NOT NULL,
    "tokenHash" text NOT NULL,
    "expiresAt" timestamp(3) with time zone NOT NULL,
    "usedAt" timestamp(3) with time zone,
    "createdAt" timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: Phase; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."Phase" (
    id uuid NOT NULL,
    "projectId" uuid NOT NULL,
    name text NOT NULL,
    "sortOrder" integer NOT NULL,
    "ownerId" uuid,
    status public."WorkStatus" DEFAULT 'TODO'::public."WorkStatus" NOT NULL,
    "plannedStart" date,
    "plannedFinish" date,
    "completionCriteria" text,
    "customerVisible" boolean DEFAULT true NOT NULL,
    version integer DEFAULT 1 NOT NULL
);


--
-- Name: Project; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."Project" (
    id uuid NOT NULL,
    "organizationId" uuid NOT NULL,
    code text NOT NULL,
    name text NOT NULL,
    description text,
    objectives text,
    "customerCompanyId" uuid,
    "managerId" uuid,
    status public."ProjectStatus" DEFAULT 'DRAFT'::public."ProjectStatus" NOT NULL,
    priority public."Priority" DEFAULT 'MEDIUM'::public."Priority" NOT NULL,
    health public."Health" DEFAULT 'GREEN'::public."Health" NOT NULL,
    "plannedStart" date NOT NULL,
    "plannedFinish" date NOT NULL,
    "calendarId" uuid,
    timezone text DEFAULT 'UTC'::text NOT NULL,
    "budgetAmount" numeric(14,2),
    "budgetCurrency" text,
    "billingEnabled" boolean DEFAULT false NOT NULL,
    "hourlyRate" numeric(10,2),
    "customerVisible" boolean DEFAULT false NOT NULL,
    "templateId" uuid,
    "workItemSeq" integer DEFAULT 0 NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    "createdAt" timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) with time zone NOT NULL
);


--
-- Name: ProjectMember; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."ProjectMember" (
    "projectId" uuid NOT NULL,
    "userId" uuid NOT NULL,
    role public."ProjectRole" NOT NULL,
    "allocationPct" integer DEFAULT 100 NOT NULL,
    "createdAt" timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: ProjectTemplate; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."ProjectTemplate" (
    id uuid NOT NULL,
    "organizationId" uuid NOT NULL,
    name text NOT NULL,
    description text,
    "isDefault" boolean DEFAULT false NOT NULL,
    "createdAt" timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: Risk; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."Risk" (
    id uuid NOT NULL,
    "projectId" uuid NOT NULL,
    title text NOT NULL,
    description text,
    probability integer DEFAULT 3 NOT NULL,
    impact integer DEFAULT 3 NOT NULL,
    "ownerId" uuid,
    mitigation text,
    status public."RegisterStatus" DEFAULT 'OPEN'::public."RegisterStatus" NOT NULL,
    "workItemId" uuid,
    "createdAt" timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: Session; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."Session" (
    id uuid NOT NULL,
    "tokenHash" text NOT NULL,
    "userId" uuid NOT NULL,
    "organizationId" uuid NOT NULL,
    "csrfToken" text NOT NULL,
    "expiresAt" timestamp(3) with time zone NOT NULL,
    "lastSeenAt" timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "createdAt" timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    ip text,
    "userAgent" text
);


--
-- Name: SlaPolicy; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."SlaPolicy" (
    id uuid NOT NULL,
    "organizationId" uuid NOT NULL,
    priority public."Priority" NOT NULL,
    "responseMinutes" integer NOT NULL,
    "resolutionMinutes" integer NOT NULL,
    "calendarId" uuid
);


--
-- Name: StatusUpdate; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."StatusUpdate" (
    id uuid NOT NULL,
    "projectId" uuid NOT NULL,
    "authorId" uuid NOT NULL,
    title text NOT NULL,
    body text NOT NULL,
    health public."Health" DEFAULT 'GREEN'::public."Health" NOT NULL,
    "customerVisible" boolean DEFAULT false NOT NULL,
    "createdAt" timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: Team; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."Team" (
    id uuid NOT NULL,
    "organizationId" uuid NOT NULL,
    name text NOT NULL,
    description text,
    "createdAt" timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: TeamMember; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."TeamMember" (
    "teamId" uuid NOT NULL,
    "userId" uuid NOT NULL
);


--
-- Name: TemplatePhase; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."TemplatePhase" (
    id uuid NOT NULL,
    "templateId" uuid NOT NULL,
    name text NOT NULL,
    "sortOrder" integer NOT NULL,
    "durationDays" integer DEFAULT 5 NOT NULL,
    "completionCriteria" text,
    milestones text[] DEFAULT ARRAY[]::text[] NOT NULL,
    deliverables text[] DEFAULT ARRAY[]::text[] NOT NULL
);


--
-- Name: Ticket; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."Ticket" (
    id uuid NOT NULL,
    "organizationId" uuid NOT NULL,
    number integer NOT NULL,
    subject text NOT NULL,
    description text NOT NULL,
    "customerCompanyId" uuid,
    "projectId" uuid,
    category text,
    type public."TicketType" DEFAULT 'QUESTION'::public."TicketType" NOT NULL,
    priority public."Priority" DEFAULT 'MEDIUM'::public."Priority" NOT NULL,
    severity integer DEFAULT 3 NOT NULL,
    status public."TicketStatus" DEFAULT 'NEW'::public."TicketStatus" NOT NULL,
    "assigneeId" uuid,
    "requesterId" uuid NOT NULL,
    "responseDueAt" timestamp(3) with time zone,
    "resolutionDueAt" timestamp(3) with time zone,
    "firstResponseAt" timestamp(3) with time zone,
    "resolvedAt" timestamp(3) with time zone,
    "closedAt" timestamp(3) with time zone,
    "slaPausedAt" timestamp(3) with time zone,
    "reopenCount" integer DEFAULT 0 NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    "createdAt" timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) with time zone NOT NULL,
    tags text[] DEFAULT ARRAY[]::text[] NOT NULL,
    "csatRating" integer,
    "csatComment" text,
    "csatAt" timestamp(3) with time zone
);


--
-- Name: TicketCategory; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."TicketCategory" (
    id uuid NOT NULL,
    "organizationId" uuid NOT NULL,
    name text NOT NULL
);


--
-- Name: TicketLink; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."TicketLink" (
    "ticketId" uuid NOT NULL,
    "workItemId" uuid NOT NULL,
    "linkType" text DEFAULT 'RELATES'::text NOT NULL,
    "createdAt" timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: TimeEntry; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."TimeEntry" (
    id uuid NOT NULL,
    "organizationId" uuid NOT NULL,
    "projectId" uuid NOT NULL,
    "workItemId" uuid,
    "userId" uuid NOT NULL,
    "timesheetId" uuid NOT NULL,
    date date NOT NULL,
    hours numeric(5,2) NOT NULL,
    billable boolean DEFAULT false NOT NULL,
    note text,
    "createdAt" timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) with time zone NOT NULL
);


--
-- Name: Timesheet; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."Timesheet" (
    id uuid NOT NULL,
    "organizationId" uuid NOT NULL,
    "userId" uuid NOT NULL,
    "weekStart" date NOT NULL,
    status public."TimesheetStatus" DEFAULT 'DRAFT'::public."TimesheetStatus" NOT NULL,
    "submittedAt" timestamp(3) with time zone,
    "reviewedById" uuid,
    "reviewedAt" timestamp(3) with time zone,
    "reviewNote" text,
    version integer DEFAULT 1 NOT NULL
);


--
-- Name: User; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."User" (
    id uuid NOT NULL,
    email text NOT NULL,
    name text NOT NULL,
    "passwordHash" text NOT NULL,
    title text,
    skills text[] DEFAULT ARRAY[]::text[] NOT NULL,
    "weeklyCapacityHours" numeric(5,2) DEFAULT 40 NOT NULL,
    "createdAt" timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) with time zone NOT NULL,
    "lastLoginAt" timestamp(3) with time zone,
    department text,
    phone text,
    "employeeId" text,
    "mustChangePassword" boolean DEFAULT false NOT NULL
);


--
-- Name: WorkItem; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."WorkItem" (
    id uuid NOT NULL,
    "projectId" uuid NOT NULL,
    "phaseId" uuid,
    "parentId" uuid,
    type public."WorkItemType" NOT NULL,
    number integer NOT NULL,
    title text NOT NULL,
    description text,
    "acceptanceCriteria" text,
    "assigneeId" uuid,
    status public."WorkStatus" DEFAULT 'TODO'::public."WorkStatus" NOT NULL,
    priority public."Priority" DEFAULT 'MEDIUM'::public."Priority" NOT NULL,
    "plannedStart" date,
    "plannedFinish" date,
    "actualStart" date,
    "actualFinish" date,
    "estimateHours" numeric(8,2),
    "percentComplete" integer DEFAULT 0 NOT NULL,
    "customerVisible" boolean DEFAULT false NOT NULL,
    labels text[] DEFAULT ARRAY[]::text[] NOT NULL,
    "sortOrder" integer DEFAULT 0 NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    "createdById" uuid,
    "createdAt" timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) with time zone NOT NULL
);


--
-- Name: WorkItemCollaborator; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."WorkItemCollaborator" (
    "workItemId" uuid NOT NULL,
    "userId" uuid NOT NULL
);


--
-- Name: WorkingCalendar; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."WorkingCalendar" (
    id uuid NOT NULL,
    "organizationId" uuid NOT NULL,
    name text NOT NULL,
    timezone text DEFAULT 'UTC'::text NOT NULL,
    "workDays" integer[] DEFAULT ARRAY[1, 2, 3, 4, 5] NOT NULL,
    "dayStart" text DEFAULT '09:00'::text NOT NULL,
    "dayEnd" text DEFAULT '17:00'::text NOT NULL,
    "isDefault" boolean DEFAULT false NOT NULL,
    "createdAt" timestamp(3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: _prisma_migrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public._prisma_migrations (
    id character varying(36) NOT NULL,
    checksum character varying(64) NOT NULL,
    finished_at timestamp with time zone,
    migration_name character varying(255) NOT NULL,
    logs text,
    rolled_back_at timestamp with time zone,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    applied_steps_count integer DEFAULT 0 NOT NULL
);


--
-- Name: Approval Approval_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Approval"
    ADD CONSTRAINT "Approval_pkey" PRIMARY KEY (id);


--
-- Name: AuditEvent AuditEvent_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."AuditEvent"
    ADD CONSTRAINT "AuditEvent_pkey" PRIMARY KEY (id);


--
-- Name: BaselineItem BaselineItem_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."BaselineItem"
    ADD CONSTRAINT "BaselineItem_pkey" PRIMARY KEY (id);


--
-- Name: Baseline Baseline_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Baseline"
    ADD CONSTRAINT "Baseline_pkey" PRIMARY KEY (id);


--
-- Name: CannedResponse CannedResponse_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."CannedResponse"
    ADD CONSTRAINT "CannedResponse_pkey" PRIMARY KEY (id);


--
-- Name: ChangeRequest ChangeRequest_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."ChangeRequest"
    ADD CONSTRAINT "ChangeRequest_pkey" PRIMARY KEY (id);


--
-- Name: ChecklistItem ChecklistItem_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."ChecklistItem"
    ADD CONSTRAINT "ChecklistItem_pkey" PRIMARY KEY (id);


--
-- Name: Comment Comment_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Comment"
    ADD CONSTRAINT "Comment_pkey" PRIMARY KEY (id);


--
-- Name: CustomerCompany CustomerCompany_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."CustomerCompany"
    ADD CONSTRAINT "CustomerCompany_pkey" PRIMARY KEY (id);


--
-- Name: Decision Decision_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Decision"
    ADD CONSTRAINT "Decision_pkey" PRIMARY KEY (id);


--
-- Name: DeliverableVersion DeliverableVersion_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."DeliverableVersion"
    ADD CONSTRAINT "DeliverableVersion_pkey" PRIMARY KEY (id);


--
-- Name: Deliverable Deliverable_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Deliverable"
    ADD CONSTRAINT "Deliverable_pkey" PRIMARY KEY (id);


--
-- Name: Dependency Dependency_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Dependency"
    ADD CONSTRAINT "Dependency_pkey" PRIMARY KEY (id);


--
-- Name: Discussion Discussion_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Discussion"
    ADD CONSTRAINT "Discussion_pkey" PRIMARY KEY (id);


--
-- Name: FileBlob FileBlob_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."FileBlob"
    ADD CONSTRAINT "FileBlob_pkey" PRIMARY KEY (key);


--
-- Name: FileObject FileObject_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."FileObject"
    ADD CONSTRAINT "FileObject_pkey" PRIMARY KEY (id);


--
-- Name: Holiday Holiday_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Holiday"
    ADD CONSTRAINT "Holiday_pkey" PRIMARY KEY (id);


--
-- Name: Invitation Invitation_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Invitation"
    ADD CONSTRAINT "Invitation_pkey" PRIMARY KEY (id);


--
-- Name: Issue Issue_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Issue"
    ADD CONSTRAINT "Issue_pkey" PRIMARY KEY (id);


--
-- Name: KnowledgeArticle KnowledgeArticle_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."KnowledgeArticle"
    ADD CONSTRAINT "KnowledgeArticle_pkey" PRIMARY KEY (id);


--
-- Name: Membership Membership_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Membership"
    ADD CONSTRAINT "Membership_pkey" PRIMARY KEY (id);


--
-- Name: Notification Notification_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Notification"
    ADD CONSTRAINT "Notification_pkey" PRIMARY KEY (id);


--
-- Name: Organization Organization_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Organization"
    ADD CONSTRAINT "Organization_pkey" PRIMARY KEY (id);


--
-- Name: PasswordResetToken PasswordResetToken_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PasswordResetToken"
    ADD CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY (id);


--
-- Name: Phase Phase_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Phase"
    ADD CONSTRAINT "Phase_pkey" PRIMARY KEY (id);


--
-- Name: ProjectMember ProjectMember_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."ProjectMember"
    ADD CONSTRAINT "ProjectMember_pkey" PRIMARY KEY ("projectId", "userId");


--
-- Name: ProjectTemplate ProjectTemplate_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."ProjectTemplate"
    ADD CONSTRAINT "ProjectTemplate_pkey" PRIMARY KEY (id);


--
-- Name: Project Project_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Project"
    ADD CONSTRAINT "Project_pkey" PRIMARY KEY (id);


--
-- Name: Risk Risk_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Risk"
    ADD CONSTRAINT "Risk_pkey" PRIMARY KEY (id);


--
-- Name: Session Session_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Session"
    ADD CONSTRAINT "Session_pkey" PRIMARY KEY (id);


--
-- Name: SlaPolicy SlaPolicy_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."SlaPolicy"
    ADD CONSTRAINT "SlaPolicy_pkey" PRIMARY KEY (id);


--
-- Name: StatusUpdate StatusUpdate_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."StatusUpdate"
    ADD CONSTRAINT "StatusUpdate_pkey" PRIMARY KEY (id);


--
-- Name: TeamMember TeamMember_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."TeamMember"
    ADD CONSTRAINT "TeamMember_pkey" PRIMARY KEY ("teamId", "userId");


--
-- Name: Team Team_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Team"
    ADD CONSTRAINT "Team_pkey" PRIMARY KEY (id);


--
-- Name: TemplatePhase TemplatePhase_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."TemplatePhase"
    ADD CONSTRAINT "TemplatePhase_pkey" PRIMARY KEY (id);


--
-- Name: TicketCategory TicketCategory_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."TicketCategory"
    ADD CONSTRAINT "TicketCategory_pkey" PRIMARY KEY (id);


--
-- Name: TicketLink TicketLink_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."TicketLink"
    ADD CONSTRAINT "TicketLink_pkey" PRIMARY KEY ("ticketId", "workItemId");


--
-- Name: Ticket Ticket_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Ticket"
    ADD CONSTRAINT "Ticket_pkey" PRIMARY KEY (id);


--
-- Name: TimeEntry TimeEntry_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."TimeEntry"
    ADD CONSTRAINT "TimeEntry_pkey" PRIMARY KEY (id);


--
-- Name: Timesheet Timesheet_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Timesheet"
    ADD CONSTRAINT "Timesheet_pkey" PRIMARY KEY (id);


--
-- Name: User User_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."User"
    ADD CONSTRAINT "User_pkey" PRIMARY KEY (id);


--
-- Name: WorkItemCollaborator WorkItemCollaborator_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."WorkItemCollaborator"
    ADD CONSTRAINT "WorkItemCollaborator_pkey" PRIMARY KEY ("workItemId", "userId");


--
-- Name: WorkItem WorkItem_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."WorkItem"
    ADD CONSTRAINT "WorkItem_pkey" PRIMARY KEY (id);


--
-- Name: WorkingCalendar WorkingCalendar_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."WorkingCalendar"
    ADD CONSTRAINT "WorkingCalendar_pkey" PRIMARY KEY (id);


--
-- Name: _prisma_migrations _prisma_migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public._prisma_migrations
    ADD CONSTRAINT _prisma_migrations_pkey PRIMARY KEY (id);


--
-- Name: Approval_deliverableVersionId_reviewerId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "Approval_deliverableVersionId_reviewerId_key" ON public."Approval" USING btree ("deliverableVersionId", "reviewerId");


--
-- Name: AuditEvent_entityType_entityId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "AuditEvent_entityType_entityId_idx" ON public."AuditEvent" USING btree ("entityType", "entityId");


--
-- Name: AuditEvent_organizationId_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "AuditEvent_organizationId_createdAt_idx" ON public."AuditEvent" USING btree ("organizationId", "createdAt");


--
-- Name: AuditEvent_projectId_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "AuditEvent_projectId_createdAt_idx" ON public."AuditEvent" USING btree ("projectId", "createdAt");


--
-- Name: BaselineItem_baselineId_workItemId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "BaselineItem_baselineId_workItemId_key" ON public."BaselineItem" USING btree ("baselineId", "workItemId");


--
-- Name: CannedResponse_organizationId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "CannedResponse_organizationId_idx" ON public."CannedResponse" USING btree ("organizationId");


--
-- Name: Comment_discussionId_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Comment_discussionId_createdAt_idx" ON public."Comment" USING btree ("discussionId", "createdAt");


--
-- Name: Comment_ticketId_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Comment_ticketId_createdAt_idx" ON public."Comment" USING btree ("ticketId", "createdAt");


--
-- Name: Comment_workItemId_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Comment_workItemId_createdAt_idx" ON public."Comment" USING btree ("workItemId", "createdAt");


--
-- Name: CustomerCompany_organizationId_name_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "CustomerCompany_organizationId_name_key" ON public."CustomerCompany" USING btree ("organizationId", name);


--
-- Name: DeliverableVersion_deliverableId_versionNumber_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "DeliverableVersion_deliverableId_versionNumber_key" ON public."DeliverableVersion" USING btree ("deliverableId", "versionNumber");


--
-- Name: Dependency_predecessorId_successorId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "Dependency_predecessorId_successorId_key" ON public."Dependency" USING btree ("predecessorId", "successorId");


--
-- Name: Dependency_projectId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Dependency_projectId_idx" ON public."Dependency" USING btree ("projectId");


--
-- Name: FileObject_projectId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "FileObject_projectId_idx" ON public."FileObject" USING btree ("projectId");


--
-- Name: FileObject_storageKey_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "FileObject_storageKey_key" ON public."FileObject" USING btree ("storageKey");


--
-- Name: FileObject_ticketId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "FileObject_ticketId_idx" ON public."FileObject" USING btree ("ticketId");


--
-- Name: FileObject_workItemId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "FileObject_workItemId_idx" ON public."FileObject" USING btree ("workItemId");


--
-- Name: Holiday_calendarId_date_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "Holiday_calendarId_date_key" ON public."Holiday" USING btree ("calendarId", date);


--
-- Name: Invitation_organizationId_email_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Invitation_organizationId_email_idx" ON public."Invitation" USING btree ("organizationId", email);


--
-- Name: Invitation_tokenHash_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "Invitation_tokenHash_key" ON public."Invitation" USING btree ("tokenHash");


--
-- Name: KnowledgeArticle_organizationId_published_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "KnowledgeArticle_organizationId_published_idx" ON public."KnowledgeArticle" USING btree ("organizationId", published);


--
-- Name: Membership_organizationId_role_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Membership_organizationId_role_idx" ON public."Membership" USING btree ("organizationId", role);


--
-- Name: Membership_organizationId_userId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "Membership_organizationId_userId_key" ON public."Membership" USING btree ("organizationId", "userId");


--
-- Name: Notification_userId_dedupeKey_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "Notification_userId_dedupeKey_key" ON public."Notification" USING btree ("userId", "dedupeKey");


--
-- Name: Notification_userId_readAt_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Notification_userId_readAt_createdAt_idx" ON public."Notification" USING btree ("userId", "readAt", "createdAt");


--
-- Name: Organization_slug_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "Organization_slug_key" ON public."Organization" USING btree (slug);


--
-- Name: PasswordResetToken_tokenHash_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "PasswordResetToken_tokenHash_key" ON public."PasswordResetToken" USING btree ("tokenHash");


--
-- Name: Phase_projectId_sortOrder_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Phase_projectId_sortOrder_idx" ON public."Phase" USING btree ("projectId", "sortOrder");


--
-- Name: ProjectMember_userId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "ProjectMember_userId_idx" ON public."ProjectMember" USING btree ("userId");


--
-- Name: ProjectTemplate_organizationId_name_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "ProjectTemplate_organizationId_name_key" ON public."ProjectTemplate" USING btree ("organizationId", name);


--
-- Name: Project_organizationId_code_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "Project_organizationId_code_key" ON public."Project" USING btree ("organizationId", code);


--
-- Name: Project_organizationId_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Project_organizationId_status_idx" ON public."Project" USING btree ("organizationId", status);


--
-- Name: Session_expiresAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Session_expiresAt_idx" ON public."Session" USING btree ("expiresAt");


--
-- Name: Session_tokenHash_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "Session_tokenHash_key" ON public."Session" USING btree ("tokenHash");


--
-- Name: Session_userId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Session_userId_idx" ON public."Session" USING btree ("userId");


--
-- Name: SlaPolicy_organizationId_priority_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "SlaPolicy_organizationId_priority_key" ON public."SlaPolicy" USING btree ("organizationId", priority);


--
-- Name: StatusUpdate_projectId_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "StatusUpdate_projectId_createdAt_idx" ON public."StatusUpdate" USING btree ("projectId", "createdAt");


--
-- Name: Team_organizationId_name_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "Team_organizationId_name_key" ON public."Team" USING btree ("organizationId", name);


--
-- Name: TemplatePhase_templateId_sortOrder_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "TemplatePhase_templateId_sortOrder_idx" ON public."TemplatePhase" USING btree ("templateId", "sortOrder");


--
-- Name: TicketCategory_organizationId_name_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "TicketCategory_organizationId_name_key" ON public."TicketCategory" USING btree ("organizationId", name);


--
-- Name: Ticket_assigneeId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Ticket_assigneeId_idx" ON public."Ticket" USING btree ("assigneeId");


--
-- Name: Ticket_customerCompanyId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Ticket_customerCompanyId_idx" ON public."Ticket" USING btree ("customerCompanyId");


--
-- Name: Ticket_organizationId_number_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "Ticket_organizationId_number_key" ON public."Ticket" USING btree ("organizationId", number);


--
-- Name: Ticket_organizationId_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Ticket_organizationId_status_idx" ON public."Ticket" USING btree ("organizationId", status);


--
-- Name: TimeEntry_projectId_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "TimeEntry_projectId_date_idx" ON public."TimeEntry" USING btree ("projectId", date);


--
-- Name: TimeEntry_userId_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "TimeEntry_userId_date_idx" ON public."TimeEntry" USING btree ("userId", date);


--
-- Name: TimeEntry_workItemId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "TimeEntry_workItemId_idx" ON public."TimeEntry" USING btree ("workItemId");


--
-- Name: Timesheet_organizationId_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Timesheet_organizationId_status_idx" ON public."Timesheet" USING btree ("organizationId", status);


--
-- Name: Timesheet_userId_weekStart_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "Timesheet_userId_weekStart_key" ON public."Timesheet" USING btree ("userId", "weekStart");


--
-- Name: User_email_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "User_email_key" ON public."User" USING btree (email);


--
-- Name: WorkItem_assigneeId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "WorkItem_assigneeId_idx" ON public."WorkItem" USING btree ("assigneeId");


--
-- Name: WorkItem_projectId_number_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "WorkItem_projectId_number_key" ON public."WorkItem" USING btree ("projectId", number);


--
-- Name: WorkItem_projectId_parentId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "WorkItem_projectId_parentId_idx" ON public."WorkItem" USING btree ("projectId", "parentId");


--
-- Name: WorkItem_projectId_phaseId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "WorkItem_projectId_phaseId_idx" ON public."WorkItem" USING btree ("projectId", "phaseId");


--
-- Name: WorkingCalendar_organizationId_name_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "WorkingCalendar_organizationId_name_key" ON public."WorkingCalendar" USING btree ("organizationId", name);


--
-- Name: Approval Approval_deliverableVersionId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Approval"
    ADD CONSTRAINT "Approval_deliverableVersionId_fkey" FOREIGN KEY ("deliverableVersionId") REFERENCES public."DeliverableVersion"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: AuditEvent AuditEvent_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."AuditEvent"
    ADD CONSTRAINT "AuditEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public."Organization"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: BaselineItem BaselineItem_baselineId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."BaselineItem"
    ADD CONSTRAINT "BaselineItem_baselineId_fkey" FOREIGN KEY ("baselineId") REFERENCES public."Baseline"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: Baseline Baseline_projectId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Baseline"
    ADD CONSTRAINT "Baseline_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES public."Project"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: CannedResponse CannedResponse_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."CannedResponse"
    ADD CONSTRAINT "CannedResponse_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public."Organization"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: ChangeRequest ChangeRequest_projectId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."ChangeRequest"
    ADD CONSTRAINT "ChangeRequest_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES public."Project"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: ChecklistItem ChecklistItem_workItemId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."ChecklistItem"
    ADD CONSTRAINT "ChecklistItem_workItemId_fkey" FOREIGN KEY ("workItemId") REFERENCES public."WorkItem"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: Comment Comment_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Comment"
    ADD CONSTRAINT "Comment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public."Organization"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: CustomerCompany CustomerCompany_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."CustomerCompany"
    ADD CONSTRAINT "CustomerCompany_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public."Organization"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: Decision Decision_projectId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Decision"
    ADD CONSTRAINT "Decision_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES public."Project"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: DeliverableVersion DeliverableVersion_deliverableId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."DeliverableVersion"
    ADD CONSTRAINT "DeliverableVersion_deliverableId_fkey" FOREIGN KEY ("deliverableId") REFERENCES public."Deliverable"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: Deliverable Deliverable_phaseId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Deliverable"
    ADD CONSTRAINT "Deliverable_phaseId_fkey" FOREIGN KEY ("phaseId") REFERENCES public."Phase"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: Deliverable Deliverable_projectId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Deliverable"
    ADD CONSTRAINT "Deliverable_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES public."Project"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: Dependency Dependency_predecessorId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Dependency"
    ADD CONSTRAINT "Dependency_predecessorId_fkey" FOREIGN KEY ("predecessorId") REFERENCES public."WorkItem"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: Dependency Dependency_projectId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Dependency"
    ADD CONSTRAINT "Dependency_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES public."Project"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: Dependency Dependency_successorId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Dependency"
    ADD CONSTRAINT "Dependency_successorId_fkey" FOREIGN KEY ("successorId") REFERENCES public."WorkItem"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: Discussion Discussion_projectId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Discussion"
    ADD CONSTRAINT "Discussion_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES public."Project"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: FileObject FileObject_deliverableVersionId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."FileObject"
    ADD CONSTRAINT "FileObject_deliverableVersionId_fkey" FOREIGN KEY ("deliverableVersionId") REFERENCES public."DeliverableVersion"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: FileObject FileObject_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."FileObject"
    ADD CONSTRAINT "FileObject_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public."Organization"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: Holiday Holiday_calendarId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Holiday"
    ADD CONSTRAINT "Holiday_calendarId_fkey" FOREIGN KEY ("calendarId") REFERENCES public."WorkingCalendar"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: Invitation Invitation_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Invitation"
    ADD CONSTRAINT "Invitation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public."Organization"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: Issue Issue_projectId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Issue"
    ADD CONSTRAINT "Issue_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES public."Project"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: KnowledgeArticle KnowledgeArticle_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."KnowledgeArticle"
    ADD CONSTRAINT "KnowledgeArticle_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public."Organization"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: Membership Membership_customerCompanyId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Membership"
    ADD CONSTRAINT "Membership_customerCompanyId_fkey" FOREIGN KEY ("customerCompanyId") REFERENCES public."CustomerCompany"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: Membership Membership_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Membership"
    ADD CONSTRAINT "Membership_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public."Organization"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: Membership Membership_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Membership"
    ADD CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: Notification Notification_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Notification"
    ADD CONSTRAINT "Notification_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public."Organization"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: Notification Notification_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Notification"
    ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: PasswordResetToken PasswordResetToken_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PasswordResetToken"
    ADD CONSTRAINT "PasswordResetToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: Phase Phase_projectId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Phase"
    ADD CONSTRAINT "Phase_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES public."Project"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: ProjectMember ProjectMember_projectId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."ProjectMember"
    ADD CONSTRAINT "ProjectMember_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES public."Project"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: ProjectMember ProjectMember_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."ProjectMember"
    ADD CONSTRAINT "ProjectMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: ProjectTemplate ProjectTemplate_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."ProjectTemplate"
    ADD CONSTRAINT "ProjectTemplate_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public."Organization"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: Project Project_calendarId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Project"
    ADD CONSTRAINT "Project_calendarId_fkey" FOREIGN KEY ("calendarId") REFERENCES public."WorkingCalendar"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: Project Project_customerCompanyId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Project"
    ADD CONSTRAINT "Project_customerCompanyId_fkey" FOREIGN KEY ("customerCompanyId") REFERENCES public."CustomerCompany"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: Project Project_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Project"
    ADD CONSTRAINT "Project_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public."Organization"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: Project Project_templateId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Project"
    ADD CONSTRAINT "Project_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES public."ProjectTemplate"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: Risk Risk_projectId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Risk"
    ADD CONSTRAINT "Risk_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES public."Project"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: Session Session_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Session"
    ADD CONSTRAINT "Session_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public."Organization"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: Session Session_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Session"
    ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: SlaPolicy SlaPolicy_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."SlaPolicy"
    ADD CONSTRAINT "SlaPolicy_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public."Organization"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: StatusUpdate StatusUpdate_projectId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."StatusUpdate"
    ADD CONSTRAINT "StatusUpdate_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES public."Project"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: TeamMember TeamMember_teamId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."TeamMember"
    ADD CONSTRAINT "TeamMember_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES public."Team"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: TeamMember TeamMember_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."TeamMember"
    ADD CONSTRAINT "TeamMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: Team Team_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Team"
    ADD CONSTRAINT "Team_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public."Organization"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: TemplatePhase TemplatePhase_templateId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."TemplatePhase"
    ADD CONSTRAINT "TemplatePhase_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES public."ProjectTemplate"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: TicketCategory TicketCategory_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."TicketCategory"
    ADD CONSTRAINT "TicketCategory_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public."Organization"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: TicketLink TicketLink_ticketId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."TicketLink"
    ADD CONSTRAINT "TicketLink_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES public."Ticket"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: TicketLink TicketLink_workItemId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."TicketLink"
    ADD CONSTRAINT "TicketLink_workItemId_fkey" FOREIGN KEY ("workItemId") REFERENCES public."WorkItem"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: Ticket Ticket_customerCompanyId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Ticket"
    ADD CONSTRAINT "Ticket_customerCompanyId_fkey" FOREIGN KEY ("customerCompanyId") REFERENCES public."CustomerCompany"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: Ticket Ticket_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Ticket"
    ADD CONSTRAINT "Ticket_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public."Organization"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: Ticket Ticket_projectId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Ticket"
    ADD CONSTRAINT "Ticket_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES public."Project"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: TimeEntry TimeEntry_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."TimeEntry"
    ADD CONSTRAINT "TimeEntry_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public."Organization"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: TimeEntry TimeEntry_projectId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."TimeEntry"
    ADD CONSTRAINT "TimeEntry_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES public."Project"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: TimeEntry TimeEntry_timesheetId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."TimeEntry"
    ADD CONSTRAINT "TimeEntry_timesheetId_fkey" FOREIGN KEY ("timesheetId") REFERENCES public."Timesheet"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: TimeEntry TimeEntry_workItemId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."TimeEntry"
    ADD CONSTRAINT "TimeEntry_workItemId_fkey" FOREIGN KEY ("workItemId") REFERENCES public."WorkItem"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: Timesheet Timesheet_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Timesheet"
    ADD CONSTRAINT "Timesheet_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public."Organization"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: WorkItemCollaborator WorkItemCollaborator_workItemId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."WorkItemCollaborator"
    ADD CONSTRAINT "WorkItemCollaborator_workItemId_fkey" FOREIGN KEY ("workItemId") REFERENCES public."WorkItem"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: WorkItem WorkItem_parentId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."WorkItem"
    ADD CONSTRAINT "WorkItem_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES public."WorkItem"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: WorkItem WorkItem_phaseId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."WorkItem"
    ADD CONSTRAINT "WorkItem_phaseId_fkey" FOREIGN KEY ("phaseId") REFERENCES public."Phase"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: WorkItem WorkItem_projectId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."WorkItem"
    ADD CONSTRAINT "WorkItem_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES public."Project"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: WorkingCalendar WorkingCalendar_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."WorkingCalendar"
    ADD CONSTRAINT "WorkingCalendar_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public."Organization"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--



-- Migration history (the app's migrator skips migrations listed here)
SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;
INSERT INTO public._prisma_migrations VALUES ('b910bd5c-6842-478f-b86d-f55b4b7f42a6', 'a6cb7fbd831a9dd8cdf604b47850d61477cb7c4f41f9e8a997aa286737f555f1', '2026-11-18 10:34:32.983128+00', '20261117000000_init', NULL, NULL, '2026-11-18 10:34:32.983128+00', 1);
INSERT INTO public._prisma_migrations VALUES ('868ada90-9499-4a73-bc36-1b1a552de903', '1ef3fbe0ad25e81e8e3dd4ff31be2426a2df16cbd5fb93fbb84e037379e7f276', '2026-11-18 10:34:33.11234+00', '20261118000000_support_desk', NULL, NULL, '2026-11-18 10:34:33.11234+00', 1);
INSERT INTO public._prisma_migrations VALUES ('816cf654-4472-4351-8a2d-913edec014f1', '7258804def3894affb9df192feaac9dd41c26fe3c2797411fff03cc301c97f97', '2026-11-18 10:34:33.126635+00', '20261118100000_user_profile', NULL, NULL, '2026-11-18 10:34:33.126635+00', 1);
