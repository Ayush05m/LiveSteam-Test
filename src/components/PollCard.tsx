import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { CheckCircle2, Circle, Lock } from 'lucide-react';
import { Poll, PollOption } from '@/hooks/useSocket';

interface PollCardProps {
    poll: Poll;
    onVote?: (optionId: string) => void;
    onClose?: () => void;
    userRole?: 'teacher' | 'student';
    hasVoted?: boolean;
}

export function PollCard({ poll, onVote, onClose, userRole, hasVoted = false }: PollCardProps) {
    const totalVotes = poll.options.reduce((sum, opt) => sum + opt.votes, 0);
    const isClosed = poll.status === 'closed';
    const canVote = !hasVoted && !isClosed && userRole === 'student';
    const canClose = userRole === 'teacher' && !isClosed;

    const getPercentage = (votes: number) => {
        if (totalVotes === 0) return 0;
        return Math.round((votes / totalVotes) * 100);
    };

    return (
        <Card className={`${isClosed ? 'bg-gray-50 border-gray-200' : 'border-primary/20'}`}>
            <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-2">
                    <CardTitle className="text-sm font-medium leading-tight">
                        {poll.question}
                    </CardTitle>
                    {isClosed && (
                        <Lock className="w-4 h-4 text-gray-400 flex-shrink-0" />
                    )}
                </div>
            </CardHeader>
            <CardContent className="space-y-2">
                {poll.options.map((option) => {
                    const percentage = getPercentage(option.votes);
                    const showResults = hasVoted || isClosed || userRole === 'teacher';

                    return (
                        <div key={option.id} className="space-y-1">
                            {canVote ? (
                                <Button
                                    variant="outline"
                                    className="w-full justify-start text-left h-auto py-2 px-3"
                                    onClick={() => onVote?.(option.id)}
                                >
                                    <Circle className="w-4 h-4 mr-2 flex-shrink-0" />
                                    <span className="text-sm">{option.text}</span>
                                </Button>
                            ) : (
                                <div className="space-y-1">
                                    <div className="flex items-center justify-between text-sm">
                                        <div className="flex items-center gap-2">
                                            {hasVoted && <CheckCircle2 className="w-4 h-4 text-green-500" />}
                                            <span className={hasVoted ? 'font-medium' : ''}>{option.text}</span>
                                        </div>
                                        {showResults && (
                                            <span className="text-xs text-gray-500 font-medium">
                                                {option.votes} ({percentage}%)
                                            </span>
                                        )}
                                    </div>
                                    {showResults && (
                                        <Progress value={percentage} className="h-2" />
                                    )}
                                </div>
                            )}
                        </div>
                    );
                })}

                <div className="pt-2 flex items-center justify-between text-xs text-gray-500">
                    <span>{totalVotes} {totalVotes === 1 ? 'vote' : 'votes'}</span>
                    {canClose && onClose && (
                        <Button size="sm" variant="outline" onClick={onClose} className="h-7 text-xs">
                            Close Poll
                        </Button>
                    )}
                    {isClosed && (
                        <span className="text-gray-400 font-medium">Closed</span>
                    )}
                </div>
            </CardContent>
        </Card>
    );
}
