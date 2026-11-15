import { ChevronDownIcon } from "lucide-react";
import { NavigationMenu as NavigationMenuPrimitive } from "radix-ui";
import type * as React from "react";
import { cn } from "@/lib/cn";

/**
 * A row of links, some of which open a panel of more links. Each panel opens under the menu itself, at the edge
 * `align` names, so a menu at the right of a header never opens off the screen.
 */
function NavigationMenu({
	className,
	align = "start",
	...props
}: React.ComponentProps<typeof NavigationMenuPrimitive.Root> & { align?: "start" | "end" }) {
	return (
		<NavigationMenuPrimitive.Root
			data-slot="navigation-menu"
			data-align={align}
			className={cn("group/navigation-menu relative flex max-w-max items-center", className)}
			{...props}
		/>
	);
}

function NavigationMenuList({ className, ...props }: React.ComponentProps<typeof NavigationMenuPrimitive.List>) {
	return (
		<NavigationMenuPrimitive.List
			data-slot="navigation-menu-list"
			className={cn("m-0 flex list-none items-center gap-0.5 p-0", className)}
			{...props}
		/>
	);
}

function NavigationMenuItem({ ...props }: React.ComponentProps<typeof NavigationMenuPrimitive.Item>) {
	return <NavigationMenuPrimitive.Item data-slot="navigation-menu-item" {...props} />;
}

/** What a trigger and a link of the row share, so both read as one row. */
const navigationMenuTriggerStyle =
	"inline-flex h-9 w-max items-center justify-center gap-1.5 rounded-field px-3 text-ui font-medium text-ink-2 no-underline transition-[background-color,color] duration-[var(--duration-fast)] outline-none hover:bg-paper-3 hover:text-ink focus-visible:outline-[1.5px] focus-visible:outline-offset-2 focus-visible:outline-focus data-[state=open]:bg-paper-3 data-[state=open]:text-ink [&_svg:not([class*='size-'])]:size-4";

function NavigationMenuTrigger({
	className,
	children,
	...props
}: React.ComponentProps<typeof NavigationMenuPrimitive.Trigger>) {
	return (
		<NavigationMenuPrimitive.Trigger
			data-slot="navigation-menu-trigger"
			className={cn(navigationMenuTriggerStyle, "group/navigation-menu-trigger", className)}
			{...props}
		>
			{children}
			<ChevronDownIcon
				className="size-3.5 transition-transform duration-200 group-data-[state=open]/navigation-menu-trigger:rotate-180 motion-reduce:transition-none"
				aria-hidden="true"
			/>
		</NavigationMenuPrimitive.Trigger>
	);
}

function NavigationMenuContent({ className, ...props }: React.ComponentProps<typeof NavigationMenuPrimitive.Content>) {
	return (
		<NavigationMenuPrimitive.Content
			data-slot="navigation-menu-content"
			className={cn(
				"absolute top-full z-50 mt-1.5 rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10 duration-100 group-data-[align=end]/navigation-menu:right-0 group-data-[align=end]/navigation-menu:origin-top-right group-data-[align=start]/navigation-menu:left-0 group-data-[align=start]/navigation-menu:origin-top-left data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
				className,
			)}
			{...props}
		/>
	);
}

function NavigationMenuLink({ className, ...props }: React.ComponentProps<typeof NavigationMenuPrimitive.Link>) {
	return (
		<NavigationMenuPrimitive.Link
			data-slot="navigation-menu-link"
			className={cn(
				"flex items-center gap-2 rounded-md p-2 text-ui text-ink no-underline transition-colors duration-[var(--duration-fast)] outline-none hover:bg-paper-3 focus-visible:bg-paper-3 data-active:bg-paper-3 [&_svg:not([class*='size-'])]:size-4",
				className,
			)}
			{...props}
		/>
	);
}

export {
	NavigationMenu,
	NavigationMenuContent,
	NavigationMenuItem,
	NavigationMenuLink,
	NavigationMenuList,
	NavigationMenuTrigger,
	navigationMenuTriggerStyle,
};
