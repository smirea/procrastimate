import type { Component } from 'svelte';
import type { IconComponentProps } from 'phosphor-svelte';
import AirplaneTilt from 'phosphor-svelte/lib/AirplaneTilt';
import Barbell from 'phosphor-svelte/lib/Barbell';
import Basket from 'phosphor-svelte/lib/Basket';
import BookOpen from 'phosphor-svelte/lib/BookOpen';
import Briefcase from 'phosphor-svelte/lib/Briefcase';
import Broom from 'phosphor-svelte/lib/Broom';
import CalendarBlank from 'phosphor-svelte/lib/CalendarBlank';
import Camera from 'phosphor-svelte/lib/Camera';
import Car from 'phosphor-svelte/lib/Car';
import Code from 'phosphor-svelte/lib/Code';
import Envelope from 'phosphor-svelte/lib/Envelope';
import FileText from 'phosphor-svelte/lib/FileText';
import FilmSlate from 'phosphor-svelte/lib/FilmSlate';
import FirstAidKit from 'phosphor-svelte/lib/FirstAidKit';
import ForkKnife from 'phosphor-svelte/lib/ForkKnife';
import GameController from 'phosphor-svelte/lib/GameController';
import Gift from 'phosphor-svelte/lib/Gift';
import GraduationCap from 'phosphor-svelte/lib/GraduationCap';
import Hash from 'phosphor-svelte/lib/Hash';
import Heart from 'phosphor-svelte/lib/Heart';
import House from 'phosphor-svelte/lib/House';
import Lightbulb from 'phosphor-svelte/lib/Lightbulb';
import ListChecks from 'phosphor-svelte/lib/ListChecks';
import Money from 'phosphor-svelte/lib/Money';
import Moon from 'phosphor-svelte/lib/Moon';
import Mountains from 'phosphor-svelte/lib/Mountains';
import MusicNotes from 'phosphor-svelte/lib/MusicNotes';
import PaintBrush from 'phosphor-svelte/lib/PaintBrush';
import PawPrint from 'phosphor-svelte/lib/PawPrint';
import PencilSimple from 'phosphor-svelte/lib/PencilSimple';
import Phone from 'phosphor-svelte/lib/Phone';
import Plant from 'phosphor-svelte/lib/Plant';
import Receipt from 'phosphor-svelte/lib/Receipt';
import ShoppingCart from 'phosphor-svelte/lib/ShoppingCart';
import Star from 'phosphor-svelte/lib/Star';
import Target from 'phosphor-svelte/lib/Target';
import UsersThree from 'phosphor-svelte/lib/UsersThree';
import Wrench from 'phosphor-svelte/lib/Wrench';
import type { Project } from 'shared/model.ts';
import type { ProjectIcon } from 'shared/project-icons.ts';

type Icon = Component<IconComponentProps>;

/** Keyed by every name, so a name added to `PROJECT_ICONS` fails the typecheck until it has a glyph here. */
const GLYPHS: Record<ProjectIcon, Icon> = {
	home: House,
	work: Briefcase,
	errands: ListChecks,
	shopping: ShoppingCart,
	groceries: Basket,
	money: Money,
	bills: Receipt,
	health: FirstAidKit,
	fitness: Barbell,
	food: ForkKnife,
	travel: AirplaneTilt,
	car: Car,
	learning: GraduationCap,
	reading: BookOpen,
	ideas: Lightbulb,
	writing: PencilSimple,
	code: Code,
	calendar: CalendarBlank,
	family: UsersThree,
	pets: PawPrint,
	garden: Plant,
	cleaning: Broom,
	repairs: Wrench,
	documents: FileText,
	email: Envelope,
	calls: Phone,
	music: MusicNotes,
	movies: FilmSlate,
	games: GameController,
	gifts: Gift,
	art: PaintBrush,
	photos: Camera,
	outdoors: Mountains,
	goals: Target,
	favorites: Star,
	love: Heart,
	someday: Moon,
};

export const projectIconGlyph = (icon: ProjectIcon | null): Icon => (icon ? GLYPHS[icon] : Hash);

export const projectIcon = (project: Pick<Project, 'icon'> | null | undefined): Icon =>
	projectIconGlyph(project?.icon ?? null);

export const projectIconName = (icon: ProjectIcon) => icon[0]!.toUpperCase() + icon.slice(1);
