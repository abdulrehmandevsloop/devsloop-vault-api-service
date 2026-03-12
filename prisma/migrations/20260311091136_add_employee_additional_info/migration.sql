-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('MALE', 'FEMALE', 'OTHER');

-- CreateEnum
CREATE TYPE "EmployeeType" AS ENUM ('FULL_TIME', 'CONSULTANT', 'CONTRACT', 'INTERN');

-- CreateEnum
CREATE TYPE "EmployeeStatus" AS ENUM ('ACTIVE', 'FREEZE', 'DEACTIVATED');

-- CreateEnum
CREATE TYPE "WorkingMode" AS ENUM ('HYBRID', 'WORK_FROM_HOME', 'ONSITE');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "cnic" VARCHAR(15),
ADD COLUMN     "dateOfBirth" TIMESTAMP(3),
ADD COLUMN     "emergencyContactName" VARCHAR(255),
ADD COLUMN     "emergencyContactPhone" VARCHAR(20),
ADD COLUMN     "emergencyContactRelation" VARCHAR(100),
ADD COLUMN     "employeeId" VARCHAR(50),
ADD COLUMN     "employeeStatus" "EmployeeStatus" NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN     "employeeType" "EmployeeType",
ADD COLUMN     "fatherName" VARCHAR(255),
ADD COLUMN     "gender" "Gender",
ADD COLUMN     "probationPeriod" INTEGER,
ADD COLUMN     "religion" VARCHAR(100),
ADD COLUMN     "sect" VARCHAR(100),
ADD COLUMN     "uniqueId" VARCHAR(50),
ADD COLUMN     "workingMode" "WorkingMode",
ADD COLUMN     "workingModel" VARCHAR(255),
ADD COLUMN     "workingShift" VARCHAR(100);
