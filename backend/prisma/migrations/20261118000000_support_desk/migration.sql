-- Support desk: tags and satisfaction on tickets, canned replies, knowledge base, database file storage.
ALTER TABLE "Ticket" ADD COLUMN "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "csatRating" INTEGER,
  ADD COLUMN "csatComment" TEXT,
  ADD COLUMN "csatAt" TIMESTAMPTZ(3);

CREATE TABLE "CannedResponse" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "title" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "createdById" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "CannedResponse_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CannedResponse_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "CannedResponse_organizationId_idx" ON "CannedResponse"("organizationId");

CREATE TABLE "KnowledgeArticle" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "title" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "category" TEXT NOT NULL DEFAULT 'General',
  "visibility" "Visibility" NOT NULL DEFAULT 'PUBLIC',
  "published" BOOLEAN NOT NULL DEFAULT false,
  "authorId" UUID NOT NULL,
  "views" INTEGER NOT NULL DEFAULT 0,
  "helpfulYes" INTEGER NOT NULL DEFAULT 0,
  "helpfulNo" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "KnowledgeArticle_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "KnowledgeArticle_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "KnowledgeArticle_organizationId_published_idx" ON "KnowledgeArticle"("organizationId", "published");

CREATE TABLE "FileBlob" (
  "key" TEXT NOT NULL,
  "data" BYTEA NOT NULL,
  "size" INTEGER NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FileBlob_pkey" PRIMARY KEY ("key")
);
