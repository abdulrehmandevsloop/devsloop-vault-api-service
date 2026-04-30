-- CreateTable
CREATE TABLE "project_bookmarks" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "project_bookmarks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "project_bookmarks_projectId_userId_key" ON "project_bookmarks"("projectId", "userId");

-- CreateIndex
CREATE INDEX "project_bookmarks_userId_idx" ON "project_bookmarks"("userId");

-- AddForeignKey
ALTER TABLE "project_bookmarks" ADD CONSTRAINT "project_bookmarks_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_bookmarks" ADD CONSTRAINT "project_bookmarks_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
