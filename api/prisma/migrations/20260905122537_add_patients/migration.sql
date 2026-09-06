-- CreateTable
CREATE TABLE "Setting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Setting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "Counter" (
    "key" TEXT NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Counter_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "Patient" (
    "id" SERIAL NOT NULL,
    "mrn" TEXT NOT NULL,
    "mrnSearch" TEXT NOT NULL,
    "identityStatus" TEXT NOT NULL DEFAULT 'permanent',
    "surname" TEXT,
    "firstName" TEXT,
    "otherNames" TEXT,
    "sex" TEXT,
    "dateOfBirth" TIMESTAMP(3),
    "estimatedAge" INTEGER,
    "phone" TEXT,
    "altPhone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "city" TEXT,
    "state" TEXT,
    "nationality" TEXT,
    "stateOfOrigin" TEXT,
    "maritalStatus" TEXT,
    "occupation" TEXT,
    "bloodGroup" TEXT,
    "genotype" TEXT,
    "knownAllergies" TEXT,
    "extra" JSONB,
    "registeredById" INTEGER,
    "registeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "mergedIntoId" INTEGER,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Patient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PatientIdentifier" (
    "id" SERIAL NOT NULL,
    "patientId" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "issuer" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PatientIdentifier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NextOfKin" (
    "id" SERIAL NOT NULL,
    "patientId" INTEGER NOT NULL,
    "name" TEXT,
    "relationship" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "isEmergencyContact" BOOLEAN NOT NULL DEFAULT true,
    "isGuarantor" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NextOfKin_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PatientPayer" (
    "id" SERIAL NOT NULL,
    "patientId" INTEGER NOT NULL,
    "payerType" TEXT NOT NULL,
    "payerName" TEXT,
    "policyNumber" TEXT,
    "plan" TEXT,
    "validFrom" TIMESTAMP(3),
    "validTo" TIMESTAMP(3),
    "isPrimary" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PatientPayer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Visit" (
    "id" SERIAL NOT NULL,
    "patientId" INTEGER NOT NULL,
    "visitNumber" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'outpatient',
    "department" TEXT,
    "doctor" TEXT,
    "payerSnapshot" JSONB,
    "status" TEXT NOT NULL DEFAULT 'open',
    "queuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Visit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PatientAttachment" (
    "id" SERIAL NOT NULL,
    "patientId" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "caption" TEXT,
    "uploadedById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PatientAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PatientMerge" (
    "id" SERIAL NOT NULL,
    "survivingId" INTEGER NOT NULL,
    "mergedId" INTEGER NOT NULL,
    "mergedById" INTEGER,
    "reason" TEXT,
    "snapshot" JSONB,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PatientMerge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Patient_mrn_key" ON "Patient"("mrn");

-- CreateIndex
CREATE UNIQUE INDEX "Patient_mrnSearch_key" ON "Patient"("mrnSearch");

-- CreateIndex
CREATE INDEX "Patient_surname_idx" ON "Patient"("surname");

-- CreateIndex
CREATE INDEX "Patient_firstName_idx" ON "Patient"("firstName");

-- CreateIndex
CREATE INDEX "Patient_phone_idx" ON "Patient"("phone");

-- CreateIndex
CREATE INDEX "Patient_dateOfBirth_idx" ON "Patient"("dateOfBirth");

-- CreateIndex
CREATE INDEX "Patient_identityStatus_idx" ON "Patient"("identityStatus");

-- CreateIndex
CREATE INDEX "Patient_deletedAt_idx" ON "Patient"("deletedAt");

-- CreateIndex
CREATE INDEX "PatientIdentifier_patientId_idx" ON "PatientIdentifier"("patientId");

-- CreateIndex
CREATE INDEX "PatientIdentifier_value_idx" ON "PatientIdentifier"("value");

-- CreateIndex
CREATE UNIQUE INDEX "PatientIdentifier_type_value_key" ON "PatientIdentifier"("type", "value");

-- CreateIndex
CREATE INDEX "NextOfKin_patientId_idx" ON "NextOfKin"("patientId");

-- CreateIndex
CREATE INDEX "PatientPayer_patientId_idx" ON "PatientPayer"("patientId");

-- CreateIndex
CREATE UNIQUE INDEX "Visit_visitNumber_key" ON "Visit"("visitNumber");

-- CreateIndex
CREATE INDEX "Visit_patientId_idx" ON "Visit"("patientId");

-- CreateIndex
CREATE INDEX "Visit_status_idx" ON "Visit"("status");

-- CreateIndex
CREATE INDEX "Visit_queuedAt_idx" ON "Visit"("queuedAt");

-- CreateIndex
CREATE INDEX "PatientAttachment_patientId_idx" ON "PatientAttachment"("patientId");

-- CreateIndex
CREATE INDEX "PatientMerge_survivingId_idx" ON "PatientMerge"("survivingId");

-- CreateIndex
CREATE INDEX "PatientMerge_mergedId_idx" ON "PatientMerge"("mergedId");

-- AddForeignKey
ALTER TABLE "Patient" ADD CONSTRAINT "Patient_registeredById_fkey" FOREIGN KEY ("registeredById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Patient" ADD CONSTRAINT "Patient_mergedIntoId_fkey" FOREIGN KEY ("mergedIntoId") REFERENCES "Patient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientIdentifier" ADD CONSTRAINT "PatientIdentifier_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NextOfKin" ADD CONSTRAINT "NextOfKin_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientPayer" ADD CONSTRAINT "PatientPayer_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Visit" ADD CONSTRAINT "Visit_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientAttachment" ADD CONSTRAINT "PatientAttachment_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientMerge" ADD CONSTRAINT "PatientMerge_survivingId_fkey" FOREIGN KEY ("survivingId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientMerge" ADD CONSTRAINT "PatientMerge_mergedId_fkey" FOREIGN KEY ("mergedId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientMerge" ADD CONSTRAINT "PatientMerge_mergedById_fkey" FOREIGN KEY ("mergedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
