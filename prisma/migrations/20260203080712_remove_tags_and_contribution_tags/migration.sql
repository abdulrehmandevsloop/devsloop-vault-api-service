/*
  Warnings:

  - You are about to drop the `contribution_tags` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `tags` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "contribution_tags" DROP CONSTRAINT "contribution_tags_contributionId_fkey";

-- DropForeignKey
ALTER TABLE "contribution_tags" DROP CONSTRAINT "contribution_tags_tagId_fkey";

-- DropTable
DROP TABLE "contribution_tags";

-- DropTable
DROP TABLE "tags";

-- DropEnum
DROP TYPE "TagCategory";
