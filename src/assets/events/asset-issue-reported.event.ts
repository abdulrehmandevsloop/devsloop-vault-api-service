export class AssetIssueReportedEvent {
  constructor(
    public readonly issueId: string,
    public readonly assetId: string,
    public readonly assetName: string,
    public readonly reportedBy: string,
    public readonly issueType: string,
    public readonly priority: string,
    public readonly timestamp: Date = new Date(),
  ) {}
}
