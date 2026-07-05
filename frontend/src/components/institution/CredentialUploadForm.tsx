'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Loader2 } from 'lucide-react';
import {
    issueCredential,
    type CredentialData,
    type CredentialIssueProgressStep,
} from '@/lib/credentialService';
import { isValidAddress } from '@/lib/contracts';
import { validateCredentialDraft } from '@/lib/credentialValidation';
import { toast } from 'sonner';
import { captureException } from '@/lib/debug';
import { CredentialUploadFormSections } from '@/components/institution/credential-upload/CredentialUploadFormSections';

interface Subject {
    id: string;
    name: string;
    marks: string;
    maxMarks: string;
    grade?: string;
}

interface CredentialUploadFormProps {
    institutionId: string;
    institutionName: string;
    institutionWallet: string;
    account: string | null;
    onSuccess?: () => void;
}

export function CredentialUploadForm({
    institutionId,
    institutionName,
    institutionWallet,
    account,
    onSuccess,
}: CredentialUploadFormProps) {
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);
    const [subjects, setSubjects] = useState<Subject[]>([]);
    const [reviewOpen, setReviewOpen] = useState(false);
    const [validationErrors, setValidationErrors] = useState<string[]>([]);
    const [progressStep, setProgressStep] = useState<
        'validate' | CredentialIssueProgressStep | null
    >(null);

    const [formData, setFormData] = useState({
        studentName: '',
        studentWallet: '',
        studentEmail: '',
        credentialType: 'diploma',
        degree: '',
        major: '',
        gpa: '',
        issueDate: new Date().toISOString().split('T')[0],
    });

    const addSubject = () => {
        const newSubject: Subject = {
            id: Date.now().toString(),
            name: '',
            marks: '',
            maxMarks: '100',
            grade: '',
        };
        setSubjects([...subjects, newSubject]);
    };

    const removeSubject = (id: string) => {
        setSubjects(subjects.filter((subject) => subject.id !== id));
    };

    const updateSubject = (id: string, field: keyof Subject, value: string) => {
        setSubjects(
            subjects.map((subject) =>
                subject.id === id ? { ...subject, [field]: value } : subject,
            ),
        );
    };

    const calculatePercentage = (marks: string, maxMarks: string) => {
        const m = parseFloat(marks);
        const max = parseFloat(maxMarks);
        if (isNaN(m) || isNaN(max) || max === 0) return '';
        return ((m / max) * 100).toFixed(2) + '%';
    };

    const getActiveSubjects = () =>
        subjects
            .filter(
                (subject) =>
                    subject.name.trim() ||
                    subject.marks.trim() ||
                    subject.maxMarks.trim() ||
                    subject.grade?.trim(),
            )
            .map((subject) => ({
                ...subject,
                name: subject.name.trim(),
                marks: subject.marks.trim(),
                maxMarks: subject.maxMarks.trim(),
                grade: subject.grade?.trim(),
            }));

    const getValidationErrors = () =>
        validateCredentialDraft(
            {
                studentName: formData.studentName,
                studentWallet: formData.studentWallet,
                credentialType: formData.credentialType,
                degree: formData.degree,
                gpa: formData.gpa,
                issueDate: formData.issueDate,
                subjects,
                file: selectedFile,
            },
            isValidAddress,
        );

    const progressSteps: Array<{ key: 'validate' | CredentialIssueProgressStep; label: string }> = [
        { key: 'validate', label: 'Validate' },
        { key: 'upload-ipfs', label: 'Upload IPFS' },
        { key: 'sign-transaction', label: 'Sign transaction' },
        { key: 'save-database', label: 'Save database' },
    ];

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        // Validate file type
        const validTypes = ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png'];
        if (!validTypes.includes(file.type)) {
            toast.error('Invalid file type. Please upload PDF, JPG, or PNG files only.');
            return;
        }

        // Validate file size (max 10MB)
        if (file.size > 10 * 1024 * 1024) {
            toast.error('File size must be less than 10MB.');
            return;
        }

        setSelectedFile(file);

        // Create preview for images
        if (file.type.startsWith('image/')) {
            const reader = new FileReader();
            reader.onloadend = () => {
                setPreviewUrl(reader.result as string);
            };
            reader.readAsDataURL(file);
        } else {
            setPreviewUrl(null);
        }

        toast.success('File selected successfully');
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (isSubmitting) {
            return;
        }

        setProgressStep('validate');
        const errors = getValidationErrors();
        setValidationErrors(errors);

        if (errors.length > 0) {
            toast.error(errors[0]);
            return;
        }

        setReviewOpen(true);
    };

    const handleConfirmIssue = async () => {
        if (isSubmitting) {
            return;
        }

        const errors = getValidationErrors();
        setValidationErrors(errors);

        if (errors.length > 0) {
            toast.error(errors[0]);
            setReviewOpen(false);
            return;
        }

        if (!account || !selectedFile) {
            toast.error('Please connect your wallet first');
            return;
        }

        setReviewOpen(false);
        setIsSubmitting(true);
        setProgressStep('validate');

        try {
            const activeSubjects = getActiveSubjects();
            const credentialData: CredentialData = {
                studentName: formData.studentName.trim(),
                studentWallet: formData.studentWallet.trim(),
                studentEmail: formData.studentEmail || undefined,
                credentialType: formData.credentialType,
                degree: formData.degree.trim(),
                major: formData.major.trim() || undefined,
                gpa: formData.gpa.trim() || undefined,
                issueDate: formData.issueDate,
                institutionId,
                institutionName,
                institutionWallet,
                file: selectedFile,
                subjects: activeSubjects.length > 0 ? activeSubjects : undefined,
            };

            toast.loading('Issuing credential...', { id: 'issue-credential' });

            const result = await issueCredential(credentialData, account, setProgressStep);

            toast.success('Credential issued successfully!', { id: 'issue-credential' });
            toast.success(`Token ID: ${result.tokenId}`, { duration: 5000 });
            toast.success(`Transaction: ${result.transactionHash.slice(0, 10)}...`, {
                duration: 5000,
            });

            // Reset form
            setFormData({
                studentName: '',
                studentWallet: '',
                studentEmail: '',
                credentialType: 'diploma',
                degree: '',
                major: '',
                gpa: '',
                issueDate: new Date().toISOString().split('T')[0],
            });
            setSelectedFile(null);
            setPreviewUrl(null);
            setSubjects([]);
            setValidationErrors([]);
            setProgressStep(null);

            // Call success callback
            if (onSuccess) {
                onSuccess();
            }
        } catch (error: unknown) {
            captureException(error, { context: 'handleConfirmIssue' });
            toast.error((error instanceof Error ? error.message : String(error)) || 'Failed to issue credential', {
                id: 'issue-credential',
            });
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <Card className="p-6 bg-white border-gray-200 shadow-lg">
            <h2 className="text-2xl font-bold text-gray-900 mb-6">Issue New Credential</h2>

            <form onSubmit={handleSubmit} className="space-y-6">
                {validationErrors.length > 0 && (
                    <div className="rounded-lg border border-red-200 bg-red-50 p-3">
                        {validationErrors.map((error) => (
                            <p key={error} className="text-sm text-red-700">
                                {error}
                            </p>
                        ))}
                    </div>
                )}

                <CredentialUploadFormSections
                    formData={formData}
                    setFormData={setFormData}
                    subjects={subjects}
                    addSubject={addSubject}
                    removeSubject={removeSubject}
                    updateSubject={updateSubject}
                    calculatePercentage={calculatePercentage}
                    selectedFile={selectedFile}
                    previewUrl={previewUrl}
                    handleFileChange={handleFileChange}
                />

                {/* Submit Button */}
                <div className="pt-4">
                    {progressStep && (
                        <div className="mb-4 grid grid-cols-2 gap-2 md:grid-cols-4">
                            {progressSteps.map((step, index) => {
                                const activeIndex = progressSteps.findIndex(
                                    (item) => item.key === progressStep,
                                );
                                const isComplete = activeIndex > index;
                                const isActive = progressStep === step.key;

                                return (
                                    <div
                                        key={step.key}
                                        className={`rounded-lg border p-2 text-xs ${
                                            isComplete || isActive
                                                ? 'border-teal-200 bg-teal-50 text-teal-700'
                                                : 'border-gray-200 bg-gray-50 text-gray-500'
                                        }`}
                                    >
                                        {isComplete
                                            ? 'Done '
                                            : isActive && isSubmitting
                                              ? '* '
                                              : ''}
                                        {step.label}
                                    </div>
                                );
                            })}
                        </div>
                    )}
                    <Button
                        type="submit"
                        disabled={isSubmitting || !selectedFile}
                        className="w-full bg-linear-to-r from-teal-600 to-cyan-600 hover:from-teal-700 hover:to-cyan-700 text-white"
                    >
                        {isSubmitting ? (
                            <>
                                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                                Issuing Credential...
                            </>
                        ) : (
                            'Issue Credential'
                        )}
                    </Button>
                </div>
            </form>

            <Dialog open={reviewOpen} onOpenChange={(open) => !isSubmitting && setReviewOpen(open)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Review Credential</DialogTitle>
                        <DialogDescription>
                            Confirm these details before wallet signing.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-3 text-sm">
                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <p className="text-gray-500">Student</p>
                                <p className="font-medium text-gray-900">
                                    {formData.studentName || 'N/A'}
                                </p>
                            </div>
                            <div>
                                <p className="text-gray-500">Credential</p>
                                <p className="font-medium text-gray-900">
                                    {formData.credentialType}
                                </p>
                            </div>
                            <div>
                                <p className="text-gray-500">Degree</p>
                                <p className="font-medium text-gray-900">
                                    {formData.degree || 'N/A'}
                                </p>
                            </div>
                            <div>
                                <p className="text-gray-500">Issue Date</p>
                                <p className="font-medium text-gray-900">
                                    {formData.issueDate || 'N/A'}
                                </p>
                            </div>
                        </div>
                        <div>
                            <p className="text-gray-500">Student Wallet</p>
                            <p className="break-all font-medium text-gray-900">
                                {formData.studentWallet || 'N/A'}
                            </p>
                        </div>
                        <div>
                            <p className="text-gray-500">Document</p>
                            <p className="font-medium text-gray-900">
                                {selectedFile?.name || 'N/A'}
                            </p>
                        </div>
                        <div>
                            <p className="text-gray-500">Subjects</p>
                            <p className="font-medium text-gray-900">
                                {getActiveSubjects().length}
                            </p>
                        </div>
                    </div>

                    <DialogFooter>
                        <Button
                            type="button"
                            variant="outline"
                            onClick={() => setReviewOpen(false)}
                            disabled={isSubmitting}
                        >
                            Back
                        </Button>
                        <Button
                            type="button"
                            onClick={handleConfirmIssue}
                            disabled={isSubmitting}
                            className="bg-linear-to-r from-teal-600 to-cyan-600 hover:from-teal-700 hover:to-cyan-700 text-white"
                        >
                            {isSubmitting ? (
                                <>
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    Issuing...
                                </>
                            ) : (
                                'Confirm and Sign'
                            )}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </Card>
    );
}
