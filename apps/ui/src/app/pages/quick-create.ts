import { afterRenderEffect, Component, computed, DestroyRef, ElementRef, inject, signal, viewChild } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import type { GameId, InstallProgress, McProviderId, McVersion } from '@hotbar/shared';
import { DownloadPrompt } from '../components/download-prompt';
import { DataSource, type DownloadOffer } from '../core/data-source';

const GAMES: { id: GameId; title: string; detail: string }[] = [
  { id: 'minecraft', title: 'Minecraft', detail: 'Java Edition. Vanilla, plugins, or mods.' },
  { id: 'fivem', title: 'FiveM', detail: 'A GTA V server. Needs a Cfx.re license key.' },
  { id: 'hytale', title: 'Hytale', detail: 'Official dedicated server. You sign in with a Hytale account once.' },
];

const GROUPS: { title: string; items: { id: McProviderId; title: string; detail: string }[] }[] = [
  { title: 'Vanilla', items: [{ id: 'vanilla', title: 'Vanilla', detail: 'Mojang’s server, with nothing added.' }] },
  {
    title: 'Plugins',
    items: [
      { id: 'paper', title: 'Paper', detail: 'The usual choice. Faster than vanilla, and plugins can come later.' },
      { id: 'purpur', title: 'Purpur', detail: 'A Paper fork with extra configuration.' },
      { id: 'spigot', title: 'Spigot', detail: 'Compiled on this machine. The first install takes several minutes. Paper is faster to set up.' },
    ],
  },
  {
    title: 'Mods',
    items: [
      { id: 'fabric', title: 'Fabric', detail: 'Light mod loader. It needs a bit more memory.' },
      { id: 'quilt', title: 'Quilt', detail: 'A Fabric fork. It needs a bit more memory.' },
      { id: 'forge', title: 'Forge', detail: 'The long-running mod loader.' },
      { id: 'neoforge', title: 'NeoForge', detail: 'The maintained Forge fork.' },
    ],
  },
];

const SIZES: { id: string; label: string; memoryMb: number; players: number; detail: string }[] = [
  { id: 'small', label: 'Small', memoryMb: 2048, players: 5, detail: 'A few friends' },
  { id: 'medium', label: 'Medium', memoryMb: 4096, players: 15, detail: 'A small community' },
  { id: 'large', label: 'Large', memoryMb: 8192, players: 40, detail: 'A busy world' },
  { id: 'custom', label: 'Custom', memoryMb: 0, players: 20, detail: 'Set the memory yourself' },
];

const MODDED = new Set<McProviderId>(['fabric', 'quilt', 'forge', 'neoforge']);

type Stage = 'game' | 'type' | 'version' | 'size' | 'details' | 'install';

@Component({
  selector: 'app-quick-create',
  imports: [RouterLink, DownloadPrompt],
  templateUrl: './quick-create.html',
})
export class QuickCreatePage {
  private readonly data = inject(DataSource);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly backLink = this.route.snapshot.queryParamMap.get('return') === 'panel' ? '/panel' : '/';

  private readonly logBox = viewChild<ElementRef<HTMLElement>>('logBox');

  protected readonly games = GAMES;
  protected readonly groups = GROUPS;
  protected readonly sizes = SIZES;
  protected readonly stage = signal<Stage>('game');
  protected readonly game = signal<GameId>('minecraft');
  protected readonly provider = signal<McProviderId>('paper');
  protected readonly snapshots = signal(false);
  protected readonly versions = signal<McVersion[]>([]);
  protected readonly version = signal('');
  protected readonly versionQuery = signal('');
  protected readonly versionError = signal<string | null>(null);
  protected readonly loadingVersions = signal(false);
  protected readonly size = signal('medium');
  protected readonly customMb = signal(4096);
  protected readonly name = signal('Paper');
  protected readonly gamemode = signal('survival');
  protected readonly difficulty = signal('easy');
  protected readonly motd = signal('A Minecraft Server');
  protected readonly seed = signal('');
  protected readonly whitelist = signal(false);
  protected readonly onlineMode = signal(true);
  protected readonly eula = signal(false);
  protected readonly licenseKey = signal('');
  protected readonly serversRoot = signal('');
  protected readonly memoryFree = signal<number | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly promptItems = signal<DownloadOffer[] | null>(null);
  protected readonly installing = signal(false);
  protected readonly log = signal<string[]>([]);
  protected readonly steps = computed(() => {
    const minecraft = this.game() === 'minecraft';
    const steps: { id: Stage; label: string }[] = [{ id: 'game', label: 'Game' }];
    if (minecraft) steps.push({ id: 'type', label: 'Type' });
    steps.push(
      { id: 'version', label: minecraft ? 'Version' : 'Channel' },
      { id: 'size', label: 'Size' },
      { id: 'details', label: 'Setup' },
    );
    return steps;
  });
  protected readonly visibleVersions = computed(() => {
    const query = this.versionQuery().trim().toLowerCase();
    const list = this.versions();
    if (!query) return list;
    return list.filter((item) => item.id.toLowerCase().includes(query));
  });

  constructor() {
    void this.data
      .machine()
      .then((machine) => {
        this.serversRoot.set(machine.serversRoot);
        this.memoryFree.set(machine.memoryFreeBytes);
      })
      .catch(() => undefined);
    afterRenderEffect(() => {
      this.log();
      const box = this.logBox()?.nativeElement;
      if (box) box.scrollTop = box.scrollHeight;
    });
  }

  protected stepIndex(): number {
    return this.steps().findIndex((step) => step.id === this.stage());
  }

  protected goTo(id: Stage): void {
    const steps = this.steps();
    const current = steps.findIndex((step) => step.id === this.stage());
    const target = steps.findIndex((step) => step.id === id);
    if (target >= 0 && target < current) this.stage.set(id);
  }

  protected back(): void {
    const previous = this.steps()[this.stepIndex() - 1];
    if (previous) this.stage.set(previous.id);
  }

  protected advance(): void {
    const stage = this.stage();
    if (stage === 'game') this.continueFromGame();
    else if (stage === 'type') void this.openVersions();
    else if (stage === 'version' && this.version()) this.stage.set('size');
    else if (stage === 'size' && this.memoryOk()) this.stage.set('details');
    else if (stage === 'details' && this.canCreate()) this.promptItems.set([this.downloadOffer()]);
  }

  protected canAdvance(): boolean {
    const stage = this.stage();
    if (stage === 'version') return Boolean(this.version()) && !this.loadingVersions();
    if (stage === 'size') return this.memoryOk();
    if (stage === 'details') return this.canCreate();
    return true;
  }

  protected advanceLabel(): string {
    return this.stage() === 'details' ? 'Create and start' : 'Continue';
  }

  protected pickGame(id: GameId): void {
    this.game.set(id);
    this.name.set(id === 'minecraft' ? this.providerTitle(this.provider()) : id === 'fivem' ? 'FiveM' : 'Hytale');
    if (id === 'hytale' && this.size() === 'small') this.size.set('medium');
  }

  protected pickProvider(id: McProviderId): void {
    this.provider.set(id);
    this.name.set(this.providerTitle(id));
    if (MODDED.has(id) && this.size() === 'small') this.size.set('medium');
  }

  protected providerChosen(id: McProviderId): boolean {
    return this.provider() === id;
  }

  protected showSpigotNote(): boolean {
    return this.game() === 'minecraft' && this.provider() === 'spigot';
  }

  protected isPaper(id: McProviderId): boolean {
    return id === 'paper';
  }

  protected continueFromGame(): void {
    if (this.game() === 'minecraft') {
      this.stage.set('type');
      return;
    }
    void this.openVersions();
  }

  protected async openVersions(): Promise<void> {
    this.versionQuery.set('');
    this.stage.set('version');
    await this.loadVersions();
  }

  protected async loadVersions(): Promise<void> {
    this.loadingVersions.set(true);
    this.versionError.set(null);
    try {
      const list = await this.versionList();
      this.versions.set(list);
      if (!list.some((item) => item.id === this.version())) this.version.set(list[0]?.id ?? '');
    } catch (error) {
      this.versions.set([]);
      this.versionError.set(error instanceof Error ? error.message : 'Could not load versions');
    } finally {
      this.loadingVersions.set(false);
    }
  }

  protected memoryMb(): number {
    if (this.size() === 'custom') return this.customMb();
    return SIZES.find((item) => item.id === this.size())?.memoryMb ?? 4096;
  }

  protected memoryOk(): boolean {
    const memory = this.memoryMb();
    return Number.isInteger(memory) && memory >= 512 && memory <= 32768;
  }

  protected players(): number {
    return this.sizePlayers(this.size());
  }

  protected sizePlayers(id: string): number {
    if (this.game() === 'fivem') {
      if (id === 'small') return 32;
      if (id === 'large') return 128;
      return 48;
    }
    return SIZES.find((item) => item.id === id)?.players ?? 20;
  }

  protected formatGb(mb: number): string {
    if (!Number.isFinite(mb)) return '';
    const gb = mb / 1024;
    return Number.isInteger(gb) ? `${gb} GB` : `${gb.toFixed(1)} GB`;
  }

  protected freeLabel(): string {
    const free = this.memoryFree();
    if (free === null) return '';
    const gb = free / 1024 / 1024 / 1024;
    return `${gb >= 10 ? Math.round(gb) : gb.toFixed(1)} GB`;
  }

  protected lowMemory(): boolean {
    const free = this.memoryFree();
    if (free === null || !this.memoryOk()) return false;
    return this.memoryMb() * 1024 * 1024 > free;
  }

  protected canCreate(): boolean {
    if (this.game() === 'fivem') return this.licenseKey().trim().length >= 8;
    return this.eula();
  }

  protected gameTitle(): string {
    return this.games.find((item) => item.id === this.game())?.title ?? 'Server';
  }

  protected providerTitle(id: McProviderId): string {
    for (const group of GROUPS) {
      const found = group.items.find((item) => item.id === id);
      if (found) return found.title;
    }
    return 'Minecraft';
  }

  protected versionTitle(id: string): string {
    if (id === 'recommended') return 'Recommended';
    if (id === 'latest') return 'Latest';
    if (id === 'release') return 'Release';
    if (id === 'pre-release') return 'Pre-release';
    return id;
  }

  protected stageTitle(): string {
    if (this.stage() === 'game') return 'Which game is this?';
    if (this.stage() === 'type') return 'What kind of Minecraft server?';
    if (this.stage() === 'version') return this.game() === 'minecraft' ? 'Which version?' : 'Which channel?';
    if (this.stage() === 'size') return 'How big should it be?';
    return 'Name it and confirm';
  }

  protected needsMoreMemory(): boolean {
    return this.game() === 'hytale' || (this.game() === 'minecraft' && MODDED.has(this.provider()));
  }

  protected async create(): Promise<void> {
    this.error.set(null);
    this.installing.set(true);
    this.log.set([]);
    this.stage.set('install');
    let jobId = '';
    const early: InstallProgress[] = [];
    const handle = (event: InstallProgress) => {
      if (event.jobId !== jobId) return;
      this.log.update((lines) => [...lines, event.error ? event.error : event.message]);
      if (event.done && event.serverId && !event.error) void this.router.navigate(['/server', event.serverId]);
      if (event.done && event.error) this.installing.set(false);
    };
    const stop = this.data.onInstall((event) => {
      if (!jobId) early.push(event);
      else handle(event);
    });
    this.destroyRef.onDestroy(stop);
    try {
      const result = await this.data.createMinecraft({
        name: this.name().trim() || 'Server',
        game: this.game(),
        provider: this.game() === 'minecraft' ? this.provider() : 'vanilla',
        version: this.version(),
        memoryMb: this.memoryMb(),
        eulaAccepted: this.game() === 'fivem' ? true : this.eula(),
        gamemode: this.gamemode() as 'survival',
        difficulty: this.difficulty() as 'easy',
        maxPlayers: this.players(),
        motd: this.motd().trim() || 'A Minecraft Server',
        whitelist: this.whitelist(),
        onlineMode: this.onlineMode(),
        seed: this.seed().trim(),
        licenseKey: this.game() === 'fivem' ? this.licenseKey().trim() : '',
        acceptDownloads: ['server'],
      });
      jobId = result.jobId;
      for (const event of early) handle(event);
    } catch (error) {
      this.installing.set(false);
      this.error.set(error instanceof Error ? error.message : 'Could not start the install');
      stop();
    }
  }

  protected cancelDownload(): void {
    this.promptItems.set(null);
  }

  protected agreeDownload(): void {
    this.promptItems.set(null);
    void this.create();
  }

  private downloadOffer(): DownloadOffer {
    if (this.game() === 'fivem') {
      return {
        id: 'server',
        title: 'FiveM server',
        detail: 'The FXServer build from runtime.fivem.net. Cfx does not publish a checksum. Nothing is downloaded until you agree.',
      };
    }
    if (this.game() === 'hytale') {
      return {
        id: 'server',
        title: 'Hytale server',
        detail: 'The official Hytale downloader. You still sign in when it asks. Nothing is downloaded until you agree.',
      };
    }
    return {
      id: 'server',
      title: `${this.providerTitle(this.provider())} ${this.versionTitle(this.version())}`,
      detail: 'The server files and the Java build Mojang lists for this version, if they are not already saved on this computer.',
    };
  }

  private async versionList(): Promise<McVersion[]> {
    if (this.game() === 'fivem') {
      return [
        { id: 'recommended', stable: true },
        { id: 'latest', stable: false },
      ];
    }
    if (this.game() === 'hytale') {
      const list: McVersion[] = [{ id: 'release', stable: true }];
      if (this.snapshots()) list.push({ id: 'pre-release', stable: false });
      return list;
    }
    return this.data.listMinecraftVersions(this.provider(), this.snapshots());
  }

}
