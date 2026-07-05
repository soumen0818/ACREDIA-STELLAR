import { Badge } from '@/components/ui/badge';
import { Shield, Lock, Award } from 'lucide-react';

interface VerificationSummaryProps {
    status: 'valid' | 'revoked' | null;
}

export function VerificationSummary({ status }: VerificationSummaryProps) {
    if (status !== 'valid') {
        return null;
    }

    return (
        <div className="flex flex-wrap justify-center gap-3">
            <Badge className="bg-green-100 px-4 py-2 text-sm text-green-800 hover:bg-green-100">
                <Shield className="mr-2 h-4 w-4" />
                Blockchain Verified
            </Badge>
            <Badge className="bg-blue-100 px-4 py-2 text-sm text-blue-800 hover:bg-blue-100">
                <Lock className="mr-2 h-4 w-4" />
                Tamper-Proof
            </Badge>
            <Badge className="bg-teal-100 px-4 py-2 text-sm text-teal-800 hover:bg-teal-100">
                <Award className="mr-2 h-4 w-4" />
                Authentic
            </Badge>
        </div>
    );
}
