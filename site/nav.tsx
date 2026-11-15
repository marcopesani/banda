/**
 * The page's header menu: the app's navigation menu, drawn where index.html keeps the same links as plain HTML for a
 * reader without scripts. The sections of the page fold into one panel, so the row is the same at every width.
 */
import { BlocksIcon, BotIcon, CodeIcon, CpuIcon, EyeIcon, type LucideIcon } from "lucide-react";
import {
	NavigationMenu,
	NavigationMenuContent,
	NavigationMenuItem,
	NavigationMenuLink,
	NavigationMenuList,
	NavigationMenuTrigger,
	navigationMenuTriggerStyle,
} from "@/components/ui/navigation-menu";
import { cn } from "@/lib/cn";

const SECTIONS: readonly { href: string; icon: LucideIcon; title: string; text: string }[] = [
	{ href: "#what", icon: BotIcon, title: "Agents", text: "A computer of their own, and routines." },
	{ href: "#connections", icon: BlocksIcon, title: "Connections", text: "GitHub, Slack, Google and any MCP server." },
	{ href: "#watches", icon: EyeIcon, title: "Watches", text: "Follow a pull request, an inbox or a calendar." },
	{ href: "#acp", icon: CodeIcon, title: "Coding agents", text: "Hand code work to any agent over ACP." },
	{ href: "#models", icon: CpuIcon, title: "Models", text: "Any provider, or a model of your own." },
];

const row = cn(navigationMenuTriggerStyle, "text-[15px]");

export function Nav() {
	return (
		<NavigationMenu align="end" aria-label="Main">
			<NavigationMenuList>
				<NavigationMenuItem>
					<NavigationMenuTrigger className="text-[15px]">Features</NavigationMenuTrigger>
					<NavigationMenuContent className="w-[min(21rem,calc(100vw-2rem))]">
						<ul className="m-0 grid list-none gap-0.5 p-0">
							{SECTIONS.map(({ href, icon: Icon, title, text }) => (
								<li key={href}>
									<NavigationMenuLink href={href} className="items-start gap-3 p-2.5">
										<Icon className="mt-0.5 text-ink-2" aria-hidden="true" />
										<span className="grid gap-0.5">
											<span className="text-[15px] leading-5 font-medium">{title}</span>
											<span className="text-ui text-ink-2">{text}</span>
										</span>
									</NavigationMenuLink>
								</li>
							))}
						</ul>
					</NavigationMenuContent>
				</NavigationMenuItem>
				<NavigationMenuItem className="max-sm:hidden">
					<NavigationMenuLink href="#start" className={row}>
						Get started
					</NavigationMenuLink>
				</NavigationMenuItem>
				<NavigationMenuItem>
					<NavigationMenuLink
						href="https://github.com/purrgrammer/banda"
						aria-label="GitHub"
						title="GitHub"
						className={cn(row, "w-9 px-0")}
					>
						<svg viewBox="0 0 16 16" fill="currentColor" className="size-[18px]" aria-hidden="true">
							<path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
						</svg>
					</NavigationMenuLink>
				</NavigationMenuItem>
			</NavigationMenuList>
		</NavigationMenu>
	);
}
