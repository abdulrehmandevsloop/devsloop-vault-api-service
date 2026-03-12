export class AssetUpdatedEvent {
  constructor(
    public readonly assetId: string,
    public readonly assetName: string,
    public readonly performedBy: string,
    public readonly changedFields: string[],
    public readonly timestamp: Date = new Date(),
  ) {}
}
