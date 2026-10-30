import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { CheckCircle2, FileText, Plus, Upload, X } from 'lucide-react';

interface Subject {
    id: string;
    name: string;
    marks: string;
    maxMarks: string;
    grade?: string;
}

interface CredentialUploadFormSectionsProps {
    formData: {
        studentName: string;
        studentWallet: string;
        studentEmail: string;
        credentialType: string;
        degree: string;
        major: string;
        gpa: string;
        issueDate: string;
        expiresAt: string;
    };
    setFormData: (value: { studentName: string; studentWallet: string; studentEmail: string; credentialType: string; degree: string; major: string; gpa: string; issueDate: string; expiresAt: string }) => void;
    subjects: Subject[];
    addSubject: () => void;
    removeSubject: (id: string) => void;
    updateSubject: (id: string, field: keyof Subject, value: string) => void;
    calculatePercentage: (marks: string, maxMarks: string) => string;
    selectedFile: File | null;
    previewUrl: string | null;
    handleFileChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
}

export function CredentialUploadFormSections({
    formData,
    setFormData,
    subjects,
    addSubject,
    removeSubject,
    updateSubject,
    calculatePercentage,
    selectedFile,
    previewUrl,
    handleFileChange,
}: CredentialUploadFormSectionsProps) {
    return (
        <>
            <div className="space-y-4">
                <h3 className="text-lg font-semibold text-foreground">Student Information</h3>
                <div>
                    <Label htmlFor="studentName">Student Name *</Label>
                    <Input
                        id="studentName"
                        placeholder="John Doe"
                        value={formData.studentName}
                        onChange={(e) => setFormData({ ...formData, studentName: e.target.value })}
                        required
                    />
                </div>
                <div>
                    <Label htmlFor="studentWallet">Student Wallet Address *</Label>
                    <Input
                        id="studentWallet"
                        placeholder="0x..."
                        value={formData.studentWallet}
                        onChange={(e) => setFormData({ ...formData, studentWallet: e.target.value })}
                        required
                    />
                </div>
                <div>
                    <Label htmlFor="studentEmail">Student Email (Optional)</Label>
                    <Input
                        id="studentEmail"
                        type="email"
                        placeholder="student@example.com"
                        value={formData.studentEmail}
                        onChange={(e) => setFormData({ ...formData, studentEmail: e.target.value })}
                    />
                </div>
            </div>

            <div className="space-y-4">
                <h3 className="text-lg font-semibold text-foreground">Credential Details</h3>
                <div>
                    <Label htmlFor="credentialType">Credential Type *</Label>
                    <Select
                        value={formData.credentialType}
                        onValueChange={(value) => setFormData({ ...formData, credentialType: value })}
                    >
                        <SelectTrigger id="credentialType" aria-label="Credential Type">
                            <SelectValue placeholder="Select credential type" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="diploma">Diploma</SelectItem>
                            <SelectItem value="degree">Degree Certificate</SelectItem>
                            <SelectItem value="transcript">Transcript</SelectItem>
                            <SelectItem value="certificate">Certificate</SelectItem>
                            <SelectItem value="achievement">Achievement Award</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
                <div>
                    <Label htmlFor="degree">Degree Name *</Label>
                    <Input
                        id="degree"
                        placeholder="Bachelor of Science"
                        value={formData.degree}
                        onChange={(e) => setFormData({ ...formData, degree: e.target.value })}
                        required
                    />
                </div>
                <div>
                    <Label htmlFor="major">Major/Specialization (Optional)</Label>
                    <Input
                        id="major"
                        placeholder="Computer Science"
                        value={formData.major}
                        onChange={(e) => setFormData({ ...formData, major: e.target.value })}
                    />
                </div>
                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <Label htmlFor="gpa">GPA (Optional)</Label>
                        <Input
                            id="gpa"
                            placeholder="3.8"
                            value={formData.gpa}
                            onChange={(e) => setFormData({ ...formData, gpa: e.target.value })}
                        />
                    </div>
                    <div>
                        <Label htmlFor="issueDate">Issue Date *</Label>
                        <Input
                            id="issueDate"
                            type="date"
                            value={formData.issueDate}
                            onChange={(e) => setFormData({ ...formData, issueDate: e.target.value })}
                            required
                        />
                    </div>
                </div>
                <div>
                    <Label htmlFor="expiresAt">Expiry Date (Optional)</Label>
                    <Input
                        id="expiresAt"
                        type="date"
                        value={formData.expiresAt}
                        min={formData.issueDate || undefined}
                        onChange={(e) => setFormData({ ...formData, expiresAt: e.target.value })}
                        aria-describedby="expiresAt-hint"
                    />
                    <p id="expiresAt-hint" className="mt-1 text-xs text-muted-foreground">
                        Leave empty if it never expires. Valid through this date (UTC); it cannot be changed after issuing.
                    </p>
                </div>
            </div>

            <div className="space-y-4">
                <div className="flex items-center justify-between">
                    <h3 className="text-lg font-semibold text-foreground">Subject-wise Marks (Optional)</h3>
                    <Button type="button" onClick={addSubject} variant="outline" size="sm">
                        <Plus className="mr-1 h-4 w-4" />
                        Add Subject
                    </Button>
                </div>
                {subjects.length > 0 ? (
                    <div className="space-y-3">
                        {subjects.map((subject) => (
                            <Card key={subject.id} className="bg-secondary/40 p-4">
                                <div className="flex items-start gap-3">
                                    <div className="flex-1 grid grid-cols-1 gap-3 md:grid-cols-4">
                                        <div>
                                            <Label className="text-xs">Subject Name</Label>
                                            <Input placeholder="Mathematics" value={subject.name} onChange={(e) => updateSubject(subject.id, 'name', e.target.value)} className="h-9" />
                                        </div>
                                        <div>
                                            <Label className="text-xs">Marks Obtained</Label>
                                            <Input type="number" placeholder="85" value={subject.marks} onChange={(e) => updateSubject(subject.id, 'marks', e.target.value)} className="h-9" />
                                        </div>
                                        <div>
                                            <Label className="text-xs">Max Marks</Label>
                                            <Input type="number" placeholder="100" value={subject.maxMarks} onChange={(e) => updateSubject(subject.id, 'maxMarks', e.target.value)} className="h-9" />
                                        </div>
                                        <div>
                                            <Label className="text-xs">Grade (Optional)</Label>
                                            <Input placeholder="A" value={subject.grade || ''} onChange={(e) => updateSubject(subject.id, 'grade', e.target.value)} className="h-9" />
                                        </div>
                                    </div>
                                    <div className="flex flex-col items-end gap-2 pt-5">
                                        <Button type="button" onClick={() => removeSubject(subject.id)} variant="ghost" size="sm" className="h-9 w-9 p-0 text-muted-foreground hover:bg-destructive/8 hover:text-destructive" aria-label="Remove subject">
                                            <X className="h-4 w-4" />
                                        </Button>
                                        {subject.marks && subject.maxMarks && (
                                            <span className="text-xs font-semibold text-success">
                                                {calculatePercentage(subject.marks, subject.maxMarks)}
                                            </span>
                                        )}
                                    </div>
                                </div>
                            </Card>
                        ))}
                        <div className="rounded-lg border border-info/25 bg-info/8 p-3">
                            <p className="text-xs text-foreground">💡 <strong>Total Subjects:</strong> {subjects.length} | <strong className="ml-2">Average:</strong> {subjects.length > 0 && subjects.every((s) => s.marks && s.maxMarks) ? `${((subjects.reduce((acc, s) => acc + (parseFloat(s.marks) / parseFloat(s.maxMarks)) * 100, 0)) / subjects.length).toFixed(2)}%` : 'N/A'}</p>
                        </div>
                    </div>
                ) : (
                    <div className="rounded-lg border border-dashed border-border py-4 text-center">
                        <p className="text-sm text-muted-foreground">No subjects added yet. Click "Add Subject" to include subject-wise marks.</p>
                    </div>
                )}
            </div>

            <div className="space-y-4">
                <h3 className="text-lg font-semibold text-foreground">Credential Document</h3>
                <div className="rounded-lg border-2 border-dashed border-border p-6 text-center transition-colors hover:border-primary">
                    <input type="file" id="fileUpload" className="hidden" accept=".pdf,.jpg,.jpeg,.png" onChange={handleFileChange} />
                    <label htmlFor="fileUpload" className="cursor-pointer">
                        <div className="flex flex-col items-center space-y-3">
                            {selectedFile ? (
                                <>
                                    <CheckCircle2 className="h-12 w-12 text-success" />
                                    <div>
                                        <p className="text-sm font-medium text-foreground">{selectedFile.name}</p>
                                        <p className="text-xs text-muted-foreground">{(selectedFile.size / 1024 / 1024).toFixed(2)} MB</p>
                                    </div>
                                </>
                            ) : (
                                <>
                                    <Upload className="h-12 w-12 text-muted-foreground" />
                                    <div>
                                        <p className="text-sm font-medium text-foreground">Click to upload credential</p>
                                        <p className="text-xs text-muted-foreground">PDF, JPG, or PNG (max 10MB)</p>
                                    </div>
                                </>
                            )}
                        </div>
                    </label>
                </div>
                {previewUrl && (
                    <div className="mt-4">
                        <p className="mb-2 text-sm font-medium text-foreground">Preview:</p>
                        <Image src={previewUrl} alt="Preview" width={400} height={256} className="max-h-64 max-w-full rounded-lg border border-border" style={{ objectFit: 'contain' }} unoptimized />
                    </div>
                )}
                {selectedFile && selectedFile.type === 'application/pdf' && (
                    <div className="flex items-center space-x-2 text-sm text-muted-foreground">
                        <FileText className="h-5 w-5" />
                        <span>The document is stored privately and only shared through the student's link</span>
                    </div>
                )}
            </div>
        </>
    );
}
