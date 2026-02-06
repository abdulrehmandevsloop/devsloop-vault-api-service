-- AlterTable
ALTER TABLE "contributions" ADD COLUMN     "reviewedAt" TIMESTAMP(3);

-- RenameForeignKey
ALTER TABLE "contributions" RENAME CONSTRAINT "contributions_userId_fkey" TO "contributions_authorId_fkey";
