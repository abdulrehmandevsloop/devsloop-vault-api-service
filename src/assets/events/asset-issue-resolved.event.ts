export class AssetIssueResolvedEvent {
  constructor(
    public readonly issueId: string,
    public readonly assetId: string,
    public readonly assetName: string,
    public readonly resolvedBy: string,
    public readonly timestamp: Date = new Date(),
  ) {}
}
