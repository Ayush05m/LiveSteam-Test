import React, { useState } from 'react';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
    DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PlusCircle, X, BarChart3 } from 'lucide-react';

interface CreatePollDialogProps {
    onCreatePoll: (question: string, options: string[], duration?: number) => void;
}

export function CreatePollDialog({ onCreatePoll }: CreatePollDialogProps) {
    const [open, setOpen] = useState(false);
    const [question, setQuestion] = useState('');
    const [options, setOptions] = useState(['', '']);
    const [duration, setDuration] = useState('');

    const handleAddOption = () => {
        if (options.length < 6) {
            setOptions([...options, '']);
        }
    };

    const handleRemoveOption = (index: number) => {
        if (options.length > 2) {
            setOptions(options.filter((_, i) => i !== index));
        }
    };

    const handleOptionChange = (index: number, value: string) => {
        const newOptions = [...options];
        newOptions[index] = value;
        setOptions(newOptions);
    };

    const handleCreate = () => {
        const validOptions = options.filter(opt => opt.trim() !== '');
        if (question.trim() && validOptions.length >= 2) {
            const durationNum = duration ? parseInt(duration) : undefined;
            onCreatePoll(question.trim(), validOptions, durationNum);

            // Reset form
            setQuestion('');
            setOptions(['', '']);
            setDuration('');
            setOpen(false);
        }
    };

    const isValid = question.trim() !== '' && options.filter(opt => opt.trim() !== '').length >= 2;

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button variant="outline" size="sm" className="gap-2">
                    <BarChart3 className="w-4 h-4" />
                    Create Poll
                </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[500px]">
                <DialogHeader>
                    <DialogTitle>Create a Poll</DialogTitle>
                    <DialogDescription>
                        Ask your students a question and gather instant feedback.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 py-4">
                    {/* Question */}
                    <div className="space-y-2">
                        <Label htmlFor="question">Question</Label>
                        <Input
                            id="question"
                            placeholder="What do you want to ask?"
                            value={question}
                            onChange={(e) => setQuestion(e.target.value)}
                        />
                    </div>

                    {/* Options */}
                    <div className="space-y-2">
                        <Label>Options (2-6)</Label>
                        <div className="space-y-2">
                            {options.map((option, index) => (
                                <div key={index} className="flex gap-2">
                                    <Input
                                        placeholder={`Option ${index + 1}`}
                                        value={option}
                                        onChange={(e) => handleOptionChange(index, e.target.value)}
                                    />
                                    {options.length > 2 && (
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            onClick={() => handleRemoveOption(index)}
                                            className="flex-shrink-0"
                                        >
                                            <X className="w-4 h-4" />
                                        </Button>
                                    )}
                                </div>
                            ))}
                        </div>
                        {options.length < 6 && (
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={handleAddOption}
                                className="w-full gap-2"
                            >
                                <PlusCircle className="w-4 h-4" />
                                Add Option
                            </Button>
                        )}
                    </div>

                    {/* Duration (optional) */}
                    <div className="space-y-2">
                        <Label htmlFor="duration">Auto-close after (optional)</Label>
                        <div className="flex gap-2 items-center">
                            <Input
                                id="duration"
                                type="number"
                                placeholder="60"
                                value={duration}
                                onChange={(e) => setDuration(e.target.value)}
                                min="10"
                                max="600"
                                className="w-24"
                            />
                            <span className="text-sm text-gray-500">seconds</span>
                        </div>
                    </div>
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={() => setOpen(false)}>
                        Cancel
                    </Button>
                    <Button onClick={handleCreate} disabled={!isValid}>
                        Create Poll
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
