export class AssetQuantityUpdatedEvent {
  constructor(
    public readonly assetId: string,
    public readonly assetName: string,
    public readonly performedBy: string,
    public readonly oldQuantity: number,
    public readonly newQuantity: number,
    public readonly timestamp: Date = new Date(),
  ) {}
}
