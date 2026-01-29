"use client";

import { AlertCircle, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import type { UploadStatus } from "@/lib/types/chat";

interface UploadProgressRingProps {
	progress: number;
	status: UploadStatus;
	size?: number;
	strokeWidth?: number;
	onRetry?: () => void;
	className?: string;
}

export function UploadProgressRing({
	progress,
	status,
	size = 40,
	strokeWidth = 3,
	onRetry,
	className,
}: UploadProgressRingProps) {
	const radius = (size - strokeWidth) / 2;
	const circumference = radius * 2 * Math.PI;
	const offset = circumference - (progress / 100) * circumference;

	if (status === "uploaded") return null;

	if (status === "error") {
		return (
			<div
				className={cn(
					"absolute inset-0 flex items-center justify-center bg-black/50 rounded-lg",
					className,
				)}
			>
				<div className="flex flex-col items-center gap-1">
					<AlertCircle className="text-destructive size-5" />
					{onRetry && (
						<button
							type="button"
							onClick={(e) => {
								e.stopPropagation();
								onRetry();
							}}
							className="flex items-center gap-1 text-xs text-white hover:text-white/80 transition-colors"
						>
							<RotateCcw className="size-3" />
							Retry
						</button>
					)}
				</div>
			</div>
		);
	}

	return (
		<div
			className={cn(
				"absolute inset-0 flex items-center justify-center bg-black/50 rounded-lg",
				className,
			)}
		>
			<svg
				width={size}
				height={size}
				className="transform -rotate-90"
				aria-label={`Upload progress: ${progress}%`}
			>
				<circle
					cx={size / 2}
					cy={size / 2}
					r={radius}
					stroke="currentColor"
					strokeWidth={strokeWidth}
					fill="none"
					className="text-white/30"
				/>
				<circle
					cx={size / 2}
					cy={size / 2}
					r={radius}
					stroke="currentColor"
					strokeWidth={strokeWidth}
					fill="none"
					strokeDasharray={circumference}
					strokeDashoffset={status === "pending" ? circumference : offset}
					strokeLinecap="round"
					className={cn(
						"text-white transition-all duration-150",
						status === "pending" && "animate-pulse",
					)}
				/>
			</svg>
		</div>
	);
}
