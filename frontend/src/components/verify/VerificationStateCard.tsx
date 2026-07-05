import { CheckCircle2, AlertCircle, ShieldCheck } from 'lucide-react';

interface VerificationStateCardProps {
    status: 'valid' | 'invalid' | 'revoked';
    title: string;
    description: string;
}

export function VerificationStateCard({ status, title, description }: VerificationStateCardProps) {
    const styles = {
        valid: {
            icon: CheckCircle2,
            iconClassName: 'text-emerald-600',
            wrapperClassName: 'border-emerald-200 bg-emerald-50',
        },
        invalid: {
            icon: AlertCircle,
            iconClassName: 'text-rose-600',
            wrapperClassName: 'border-rose-200 bg-rose-50',
        },
        revoked: {
            icon: ShieldCheck,
            iconClassName: 'text-amber-600',
            wrapperClassName: 'border-amber-200 bg-amber-50',
        },
    } as const;

    const current = styles[status];
    const Icon = current.icon;

    return (
        <div className={`rounded-2xl border p-6 shadow-sm ${current.wrapperClassName}`}>
            <div className="flex items-start gap-3">
                <div className="rounded-full bg-white/80 p-2">
                    <Icon className={`h-6 w-6 ${current.iconClassName}`} />
                </div>
                <div>
                    <h3 className="text-lg font-semibold text-slate-900">{title}</h3>
                    <p className="mt-2 text-sm leading-6 text-slate-600">{description}</p>
                </div>
            </div>
        </div>
    );
}
