export class AssetTypeUpdatedEvent {
  constructor(
    public readonly assetTypeId: string,
    public readonly assetTypeName: string,
    public readonly performedBy: string,
    public readonly changedFields: string[],
    public readonly timestamp: Date = new Date(),
  ) {}
}
