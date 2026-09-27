import {
  AlertTriangle,
  BookOpen,
  Bug,
  Building2,
  Calendar,
  ChartBar,
  CircleHelp,
  Clock,
  Code,
  Database,
  DollarSign,
  FileText,
  Flag,
  FlaskConical,
  Gauge,
  GitBranch,
  Globe,
  GraduationCap,
  Heart,
  Layers,
  Library,
  Lightbulb,
  Link,
  ListChecks,
  MapPin,
  MessageCircle,
  MessageSquare,
  Mic,
  Milestone,
  Monitor,
  Package,
  PanelsTopLeft,
  Plug,
  Puzzle,
  Quote,
  Rocket,
  Scale,
  Search,
  Server,
  ShieldAlert,
  Siren,
  Sparkles,
  SquareCheck,
  Star,
  Store,
  Swords,
  Tag,
  Target,
  ThumbsDown,
  ThumbsUp,
  TrendingUp,
  User,
  Users,
  Workflow,
  type LucideIcon,
} from 'lucide-react'
import { useSyncExternalStore } from 'react'
import type * as Y from 'yjs'
import { BUILTIN_TYPES, skillTypeRegistry, typeDef, type BoardSkill, type SkillIcon, type TypeId, type TypeRegistry } from '@aifig/shared'

const ICONS: Record<SkillIcon, LucideIcon> = {
  Sparkles, CircleHelp, Quote, FlaskConical, Lightbulb, SquareCheck, Tag, User, Users, Building2, Store, Swords,
  Target, Flag, Star, Heart, ThumbsUp, ThumbsDown, AlertTriangle, Bug, Rocket, Calendar, Clock, MapPin,
  DollarSign, ChartBar, TrendingUp, Layers, Link, FileText, BookOpen, MessageSquare, Mic, Search, Puzzle, Package,
  Database, Server, Globe, Scale, Plug, Code, GitBranch, Monitor, Gauge,
  ListChecks, GraduationCap, Library, ShieldAlert, Milestone, Workflow, Siren, PanelsTopLeft, MessageCircle,
}

/** The board open in the canvas: built-in types plus the types of its enabled skills. */
let types: TypeRegistry = BUILTIN_TYPES
let skills: BoardSkill[] = []
const listeners = new Set<() => void>()
const subscribe = (fn: () => void) => {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export const currentTypes = () => types
export const useTypes = () => useSyncExternalStore(subscribe, () => types)
export const useBoardSkills = () => useSyncExternalStore(subscribe, () => skills)

/** Follow a board's `skills` map (enable / disable / hot reload) so its types render immediately. */
export function bindBoardSkills(doc: Y.Doc) {
  const map = doc.getMap<BoardSkill>('skills')
  const update = () => {
    skills = [...map.values()].sort((a, b) => a.name.localeCompare(b.name))
    types = skillTypeRegistry(skills)
    listeners.forEach((l) => l())
  }
  update()
  map.observe(update)
  return () => {
    map.unobserve(update)
    skills = []
    types = BUILTIN_TYPES
    listeners.forEach((l) => l())
  }
}

export function typeIcon(id: TypeId, reg: TypeRegistry = types): LucideIcon {
  return ICONS[typeDef(id, reg).icon as SkillIcon] ?? Tag
}

export const iconByName = (name: string): LucideIcon => ICONS[name as SkillIcon] ?? Tag
